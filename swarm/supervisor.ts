/**
 * Continuous supervisor — periodically refills worker pools from ready work.
 *
 * One ProjectSupervisor instance runs per project in the harness process.
 * The supervisor calls `br ready --json` read-only to find unassigned work,
 * spawns workers to fill pool deficits, and replaces exited workers.
 *
 * It does NOT claim, close, or modify beads. Workers own their own lifecycle
 * per the target project's AGENTS.md.
 */

import { execSync } from 'node:child_process';
import type { MessengerConfig, SupervisorConfig, WorkerPoolConfig } from '../config.js';
import { loadConfig } from '../config.js';
import { isModelAvailable } from '../model-discovery.js';
import {
  cleanupExitedSpawned,
  reconcileSpawnedAgents,
  listSpawned,
  spawnSubagent,
} from './spawn.js';
import type { SpawnedAgent } from './types.js';
import { result } from './result.js';

export const SUPERVISOR_SESSION_ID = 'pi-swarm-supervisor';

export interface ReadyBead {
  id: string;
  title: string;
  priority?: number;
  labels: string[];
}

export interface ProjectSupervisorSnapshot {
  cwd: string;
  enabled: boolean;
  paused: boolean;
  lastTickAt?: string;
  nextTickAt?: string;
  lastReadyCount?: number;
  lastSpawnedCount?: number;
  lastReason?: string;
  lastError?: string;
}

export type SupervisorIdleReason =
  | 'disabled'
  | 'paused'
  | 'capacity_full'
  | 'no_ready_beads'
  | 'workers_selecting_work'
  | 'model_unavailable'
  | 'no_enabled_pools'
  | 'error';

export interface PoolRuntime {
  config: WorkerPoolConfig;
  running: number;
  deficit: number;
  modelAvailable: boolean;
}

export interface PoolRefillOrderItem {
  poolId: string;
  starts: number;
}

/**
 * Read ready beads via `br ready --json` (read-only).
 */
export function readReadyBeads(cwd: string, limit = 100): ReadyBead[] {
  try {
    const output = execSync(`RUST_LOG=error br ready --json --limit ${limit}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return normalizeReadyBeads(JSON.parse(output));
  } catch {
    return [];
  }
}

/**
 * Normalize raw `br ready --json` output into ReadyBead[].
 * Rejects unsupported shapes with an empty array (supervisor idles).
 */
export function normalizeReadyBeads(raw: unknown): ReadyBead[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: String(item.id ?? ''),
      title: String(item.title ?? ''),
      priority: typeof item.priority === 'number' ? item.priority : undefined,
      labels: Array.isArray(item.labels) ? item.labels.map(String) : [],
    }))
    .filter((bead) => bead.id.length > 0);
}

/**
 * List running spawned agents for a project (managed + manual).
 */
function listProjectRunningSpawns(cwd: string): SpawnedAgent[] {
  cleanupExitedSpawned(cwd, SUPERVISOR_SESSION_ID);
  reconcileSpawnedAgents(cwd, SUPERVISOR_SESSION_ID);
  return listSpawned(cwd, SUPERVISOR_SESSION_ID).filter((a) => a.status === 'running');
}

/**
 * Build pool runtime state from config and current running workers.
 */
export function buildPoolRuntime(
  config: MessengerConfig,
  running: SpawnedAgent[],
): PoolRuntime[] {
  return config.supervisor.workerPools
    .filter((p) => p.enabled)
    .map((pool) => {
      const poolWorkers = running.filter(
        (w) => w.poolId === pool.id || (w.poolId === undefined && pool.id === 'default'),
      );
      const modelAvailable =
        pool.model.mode === 'inherit' || isModelAvailable(pool.model.model);
      return {
        config: pool,
        running: poolWorkers.length,
        deficit: Math.max(0, pool.workers - poolWorkers.length),
        modelAvailable,
      };
    });
}

/**
 * Compute refill order: pools with the largest deficit first, up to globalFree.
 */
export function poolRefillOrder(
  pools: PoolRuntime[],
  globalFree: number,
): PoolRefillOrderItem[] {
  const deficitPools = pools
    .filter((p) => p.deficit > 0 && p.modelAvailable)
    .sort((a, b) => b.deficit - a.deficit);

  const order: PoolRefillOrderItem[] = [];
  let remaining = globalFree;
  for (const pool of deficitPools) {
    if (remaining <= 0) break;
    const starts = Math.min(pool.deficit, remaining);
    order.push({ poolId: pool.config.id, starts });
    remaining -= starts;
  }
  return order;
}

/**
 * Spawn a pool worker with the pool's model and a generic one-bead mission.
 */
function spawnPoolWorker(cwd: string, pool: WorkerPoolConfig): void {
  const model = pool.model.mode === 'inherit' ? undefined : pool.model.model;
  spawnSubagent(
    cwd,
    {
      role: 'Worker',
      objective: 'Read AGENTS.md, register with Agent Mail, claim one ready Bead, implement it, commit, push, and exit.',
      model,
    },
    SUPERVISOR_SESSION_ID,
    undefined,
  );
}

export class ProjectSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private tickAgain = false;
  private snapshot: ProjectSupervisorSnapshot;

  constructor(readonly cwd: string) {
    this.snapshot = {
      cwd,
      enabled: false,
      paused: false,
    };
  }

  start(): void {
    if (this.timer) return;
    const config = loadConfig(this.cwd);
    this.timer = setInterval(
      () => void this.requestTick('interval'),
      config.supervisor.pollIntervalMs,
    );
    void this.requestTick('start');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getSnapshot(): ProjectSupervisorSnapshot {
    return { ...this.snapshot };
  }

  async requestTick(reason: string): Promise<void> {
    if (this.ticking) {
      this.tickAgain = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.tickAgain = false;
        await this.tick(reason);
        reason = 'coalesced';
      } while (this.tickAgain);
    } finally {
      this.ticking = false;
    }
  }

  private async tick(reason: string): Promise<void> {
    const config = loadConfig(this.cwd);
    this.snapshot.lastTickAt = new Date().toISOString();

    if (!config.supervisor.enabled || config.supervisor.paused) {
      this.recordIdle(config.supervisor.paused ? 'paused' : 'disabled');
      return;
    }

    const running = listProjectRunningSpawns(this.cwd);
    if (running.length >= config.maxConcurrentSpawns) {
      this.recordIdle('capacity_full');
      return;
    }

    const ready = readReadyBeads(this.cwd, Math.min(100, config.maxConcurrentSpawns * 4));
    this.snapshot.lastReadyCount = ready.length;
    if (ready.length === 0) {
      this.recordIdle('no_ready_beads');
      return;
    }

    // Re-read config and occupancy after the br call
    const freshConfig = loadConfig(this.cwd);
    if (!freshConfig.supervisor.enabled || freshConfig.supervisor.paused) {
      this.recordIdle(freshConfig.supervisor.paused ? 'paused' : 'disabled');
      return;
    }

    const freshRunning = listProjectRunningSpawns(this.cwd);
    const globalFree = Math.max(0, freshConfig.maxConcurrentSpawns - freshRunning.length);
    if (globalFree === 0) {
      this.recordIdle('capacity_full');
      return;
    }

    // Count workers without a reported currentBeadId as pending selectors
    const pendingSelectors = freshRunning.filter(
      (w) => !w.poolId && w.status === 'running',
    ).length;
    const availableReadyDemand = Math.max(0, ready.length - pendingSelectors);
    if (availableReadyDemand === 0) {
      this.recordIdle('workers_selecting_work');
      return;
    }

    const pools = buildPoolRuntime(freshConfig, freshRunning);
    const enabledPools = pools.filter((p) => p.config.enabled);
    if (enabledPools.length === 0) {
      this.recordIdle('no_enabled_pools');
      return;
    }

    const unavailablePools = enabledPools.filter((p) => !p.modelAvailable);
    if (enabledPools.every((p) => !p.modelAvailable)) {
      this.recordIdle('model_unavailable');
      return;
    }

    const order = poolRefillOrder(pools, globalFree);
    const starts = Math.min(
      freshConfig.supervisor.maxStartsPerTick,
      order.reduce((sum, o) => sum + o.starts, 0),
      availableReadyDemand,
    );

    let spawned = 0;
    const poolMap = new Map(freshConfig.supervisor.workerPools.map((p) => [p.id, p]));
    for (const item of order) {
      if (spawned >= starts) break;
      const pool = poolMap.get(item.poolId);
      if (!pool) continue;
      for (let i = 0; i < item.starts && spawned < starts; i++) {
        spawnPoolWorker(this.cwd, pool);
        spawned++;
      }
    }

    this.snapshot.lastSpawnedCount = spawned;
    this.snapshot.lastReason = spawned > 0 ? `spawned ${spawned} worker(s)` : 'no_deficit';
  }

  private recordIdle(reason: SupervisorIdleReason): void {
    this.snapshot.lastReason = reason;
    this.snapshot.lastSpawnedCount = 0;
  }
}
