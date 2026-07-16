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
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MessengerConfig, SupervisorConfig, WorkerPoolConfig } from '../config.js';
import { loadConfig } from '../config.js';
import { isModelAvailable } from '../model-discovery.js';
import {
  cleanupExitedSpawned,
  reconcileSpawnedAgents,
  listSpawned,
  listSpawnedHistory,
  spawnSubagent,
} from './spawn.js';
import type { SpawnedAgent } from './types.js';
import { result } from './result.js';

export const SUPERVISOR_SESSION_ID = 'pi-swarm-supervisor';
export const ENRICHMENT_MARKER = '<!-- pi-ultra-messenger:context-rich-v1 -->';
const AUTOMATIC_ENRICHMENT_PREFIX = 'AUTO-ENRICH';

export interface ReadyBead {
  id: string;
  title: string;
  description: string;
  design: string;
  acceptanceCriteria: string;
  notes: string;
  dependencyCount: number;
  priority?: number;
  labels: string[];
}

export type BeadQualityCriterion =
  | 'description_depth'
  | 'context_and_rationale'
  | 'outcome'
  | 'scope_and_boundaries'
  | 'acceptance_criteria'
  | 'failure_modes_and_recovery'
  | 'verification_plan'
  | 'dependencies'
  | 'implementation_context';

export interface BeadQualityAssessment {
  bead: ReadyBead;
  score: number;
  threshold: number;
  passes: boolean;
  missingCriteria: BeadQualityCriterion[];
  alreadyEnriched: boolean;
}

export interface ProjectSupervisorSnapshot {
  cwd: string;
  enabled: boolean;
  paused: boolean;
  lastTickAt?: string;
  nextTickAt?: string;
  lastReadyCount?: number;
  lastQualityReadyCount?: number;
  lastThinBeadCount?: number;
  lastQualityThreshold?: number;
  lastEnricherBeadId?: string;
  lastSpawnedCount?: number;
  lastReason?: string;
  lastError?: string;
}

export type SupervisorIdleReason =
  | 'disabled'
  | 'paused'
  | 'capacity_full'
  | 'no_ready_beads'
  | 'awaiting_enrichment'
  | 'quality_gate_failed'
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
 * Check if there are in-progress beads via `br list --status in_progress --json` (read-only).
 */
function hasInProgressBeads(cwd: string): boolean {
  try {
    const output = execSync('RUST_LOG=error br list --status in_progress --json', {
      cwd,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
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
    .map((item) => {
      const dependencies = [item.dependencies, item.depends_on, item.dependsOn].find(Array.isArray);
      return {
        id: String(item.id ?? ''),
        title: String(item.title ?? ''),
        description: String(item.description ?? ''),
        design: String(item.design ?? ''),
        acceptanceCriteria: String(item.acceptance_criteria ?? item.acceptanceCriteria ?? ''),
        notes: String(item.notes ?? ''),
        dependencyCount: Array.isArray(dependencies) ? dependencies.length : 0,
        priority: typeof item.priority === 'number' ? item.priority : undefined,
        labels: Array.isArray(item.labels) ? item.labels.map(String) : [],
      };
    })
    .filter((bead) => bead.id.length > 0);
}

function beadText(bead: ReadyBead): string {
  return [bead.description, bead.design, bead.acceptanceCriteria, bead.notes]
    .filter((value) => value.trim().length > 0)
    .join('\n\n');
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Score whether a Bead is executable memory rather than a thin reminder.
 * Outcome, acceptance criteria, and verification are mandatory even when
 * the weighted score reaches the configured threshold.
 */
export function assessBeadQuality(bead: ReadyBead, threshold = 75): BeadQualityAssessment {
  const text = beadText(bead);
  const words = text.trim().length === 0 ? [] : text.trim().split(/\s+/);
  const depthScore =
    words.length >= 120 && text.length >= 700
      ? 10
      : words.length >= 60 && text.length >= 350
        ? 5
        : 0;

  const present = new Map<BeadQualityCriterion, boolean>([
    ['description_depth', depthScore > 0],
    [
      'context_and_rationale',
      matchesAny(text, [
        /\bcontext\b/i,
        /\bbackground\b/i,
        /\brationale\b/i,
        /\bwhy\b/i,
        /\bproblem statement\b/i,
        /\bmotivation\b/i,
      ]),
    ],
    [
      'outcome',
      matchesAny(text, [
        /\boutcome\b/i,
        /\bobjective\b/i,
        /\bexpected result\b/i,
        /\bdeliverable\b/i,
      ]),
    ],
    [
      'scope_and_boundaries',
      matchesAny(text, [
        /\bscope\b/i,
        /\bnon-goals?\b/i,
        /\bboundar(?:y|ies)\b/i,
        /\bconstraints?\b/i,
      ]),
    ],
    [
      'acceptance_criteria',
      bead.acceptanceCriteria.trim().length > 0 ||
        matchesAny(text, [/\bacceptance criteria\b/i, /\bdefinition of done\b/i, /\bdone when\b/i]),
    ],
    [
      'failure_modes_and_recovery',
      matchesAny(text, [
        /\bfailure modes?\b/i,
        /\berror handling\b/i,
        /\brecovery\b/i,
        /\bretr(?:y|ies)\b/i,
        /\brollback\b/i,
        /\bedge cases?\b/i,
      ]),
    ],
    [
      'verification_plan',
      matchesAny(text, [
        /\bverification\b/i,
        /\btest plan\b/i,
        /\bunit tests?\b/i,
        /\bintegration tests?\b/i,
        /\be2e\b/i,
        /\bplaywright\b/i,
        /\bvitest\b/i,
      ]),
    ],
    [
      'dependencies',
      bead.dependencyCount > 0 ||
        matchesAny(text, [
          /\bdependencies\b/i,
          /\bdepends on\b/i,
          /\bblocked by\b/i,
          /\bprerequisites?\b/i,
        ]),
    ],
    [
      'implementation_context',
      bead.design.trim().length > 0 ||
        matchesAny(text, [
          /\bimplementation notes?\b/i,
          /\baffected files?\b/i,
          /\bfile surface\b/i,
          /\bcomponents?\b/i,
          /\bdata flow\b/i,
          /\barchitecture\b/i,
        ]),
    ],
  ]);

  const weights: Record<BeadQualityCriterion, number> = {
    description_depth: depthScore,
    context_and_rationale: 10,
    outcome: 15,
    scope_and_boundaries: 10,
    acceptance_criteria: 20,
    failure_modes_and_recovery: 10,
    verification_plan: 15,
    dependencies: 5,
    implementation_context: 5,
  };
  const missingCriteria = [...present.entries()]
    .filter(([, isPresent]) => !isPresent)
    .map(([criterion]) => criterion);
  const score = [...present.entries()].reduce(
    (total, [criterion, isPresent]) => total + (isPresent ? weights[criterion] : 0),
    0
  );
  const required: BeadQualityCriterion[] = ['outcome', 'acceptance_criteria', 'verification_plan'];
  const requiredPresent = required.every((criterion) => present.get(criterion) === true);

  return {
    bead,
    score,
    threshold,
    passes: score >= threshold && requiredPresent,
    missingCriteria,
    alreadyEnriched: bead.description.includes(ENRICHMENT_MARKER),
  };
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
export function buildPoolRuntime(config: MessengerConfig, running: SpawnedAgent[]): PoolRuntime[] {
  return config.supervisor.workerPools
    .filter((p) => p.enabled)
    .map((pool) => {
      const poolWorkers = running.filter(
        (w) => w.poolId === pool.id || (w.poolId === undefined && pool.id === 'default')
      );
      const modelAvailable = pool.model.mode === 'inherit' || isModelAvailable(pool.model.model);
      return {
        config: pool,
        running: poolWorkers.length,
        deficit: Math.max(0, pool.workers - poolWorkers.length),
        modelAvailable,
      };
    });
}

/**
 * Compute refill order: deterministic round-robin across pools with deficits.
 * Each round gives one worker to the next pool that still has a deficit,
 * cycling through pools in config order until globalFree is exhausted.
 */
export function poolRefillOrder(pools: PoolRuntime[], globalFree: number): PoolRefillOrderItem[] {
  const eligible = pools.filter((p) => p.deficit > 0 && p.modelAvailable);
  if (eligible.length === 0) return [];

  const order: PoolRefillOrderItem[] = [];
  const remaining = new Map<string, number>();
  for (const p of eligible) remaining.set(p.config.id, p.deficit);

  let totalToStart = Math.min(
    globalFree,
    eligible.reduce((s, p) => s + p.deficit, 0)
  );

  while (totalToStart > 0) {
    let startedAny = false;
    for (const pool of eligible) {
      if (totalToStart <= 0) break;
      const left = remaining.get(pool.config.id) ?? 0;
      if (left <= 0) continue;

      const existing = order.find((o) => o.poolId === pool.config.id);
      if (existing) {
        existing.starts++;
      } else {
        order.push({ poolId: pool.config.id, starts: 1 });
      }
      remaining.set(pool.config.id, left - 1);
      totalToStart--;
      startedAny = true;
    }
    if (!startedAny) break;
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
      objective:
        'Read AGENTS.md, register with Agent Mail, claim one quality-approved ready Bead, read its full br show output and comments, implement it, commit, push, and exit.',
      model,
    },
    SUPERVISOR_SESSION_ID,
    undefined
  );
}

function resolveEnricherRoleFile(cwd: string, configured?: string): string | undefined {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const configuredPath = configured
    ? isAbsolute(configured)
      ? configured
      : resolve(cwd, configured)
    : undefined;
  const candidates = [
    configuredPath,
    resolve(cwd, 'agents', 'goal-refiner.md'),
    resolve(moduleDir, '..', 'agents', 'goal-refiner.md'),
    resolve(moduleDir, '..', '..', 'agents', 'goal-refiner.md'),
  ];
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate))
  );
}

function automaticEnrichmentObjective(assessment: BeadQualityAssessment): string {
  const { bead, score, threshold, missingCriteria } = assessment;
  return [
    `${AUTOMATIC_ENRICHMENT_PREFIX} ${bead.id}: raise this ready Bead from ${score}/100 to at least ${threshold}/100 before implementation.`,
    `Missing criteria: ${missingCriteria.join(', ') || 'none detected'}.`,
    `Read \`br show ${bead.id} --json\`, its comments, related open Beads, AGENTS.md, README.md, and the relevant plan sections.`,
    'Preserve every owner-authored decision, but replace thin reminders with self-contained executable memory.',
    `Rewrite the Bead description with \`br update ${bead.id} --description ...\`. The first line must be ${ENRICHMENT_MARKER}.`,
    'Use explicit Markdown sections: Context and Rationale, Outcome, Scope and Boundaries, Acceptance Criteria, Failure Modes and Recovery, Dependencies, Implementation Notes, and Verification Plan.',
    'Embed relevant plan intent directly; do not merely tell the future worker to read the original plan.',
    'Add evidence-backed dependency edges with br dep add only when the plan or existing graph clearly proves them. Never invent architecture or dependencies.',
    `Add one audit comment with \`br comments add ${bead.id} ...\` summarizing what was enriched and any unanswered questions.`,
    'Do not claim, assign, close, reprioritize, or edit source files. Exit after the updated Bead and audit comment are persisted.',
  ].join('\n');
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
      config.supervisor.pollIntervalMs
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
    this.snapshot.enabled = config.supervisor.enabled;
    this.snapshot.paused = config.supervisor.paused;

    this.reconcileEnricher();

    if (config.supervisor.enabled && !config.supervisor.paused) {
      await this.refill(config);
    } else {
      this.recordIdle(config.supervisor.paused ? 'paused' : 'disabled');
    }

    // Coordinator trigger runs after every tick — including early returns
    // from refill (no ready beads, capacity full, etc.). Uses full spawn
    // history (including failed) and real in-progress bead state.
    await this.maybeRunIntervalCoordinator(config);
  }

  private async refill(config: MessengerConfig): Promise<void> {
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

    // Pending selectors are running pool workers that have not yet claimed a
    // bead. Goal Refiner and Coordinator roles never claim implementation
    // work, so they must not suppress worker allocation.
    const pendingSelectors = freshRunning.filter(
      (w) =>
        !w.poolId && w.status === 'running' && w.role !== 'Goal Refiner' && w.role !== 'Coordinator'
    ).length;
    const availableReadyDemand = Math.max(0, ready.length - pendingSelectors);
    if (availableReadyDemand === 0) {
      this.recordIdle('workers_selecting_work');
      return;
    }

    const refiner = freshConfig.supervisor.goalRefiner;
    const automaticGate =
      refiner.enabled && refiner.mode === 'automatic' && refiner.model.mode === 'exact';
    let eligible = ready;
    if (automaticGate) {
      const threshold = refiner.minimumQualityScore;
      this.snapshot.lastQualityThreshold = threshold;
      const assessments = ready.map((bead) => assessBeadQuality(bead, threshold));
      const qualityReady = assessments.filter((a) => a.passes).map((a) => a.bead);
      const thinBeads = assessments.filter((a) => !a.passes && !a.alreadyEnriched);
      this.snapshot.lastQualityReadyCount = qualityReady.length;
      this.snapshot.lastThinBeadCount = thinBeads.length;

      const enricherBusy = this.enricherSpawnId !== null;
      if (
        !enricherBusy &&
        thinBeads.length > 0 &&
        this.hasEnricherCapacity(freshConfig, freshRunning)
      ) {
        const target = thinBeads[0];
        this.spawnEnricher(freshConfig, target);
        this.snapshot.lastEnricherBeadId = target.bead.id;
        this.snapshot.lastReason = `awaiting_enrichment:${target.bead.id}`;
        this.snapshot.lastSpawnedCount = 0;
        // Do not return: if quality-ready beads already exist, keep allocating workers to them.
      } else if (enricherBusy && thinBeads.length > 0) {
        this.recordIdle('awaiting_enrichment');
        return;
      }

      if (qualityReady.length === 0) {
        this.recordIdle(
          this.enricherSpawnId !== null || thinBeads.length > 0
            ? 'awaiting_enrichment'
            : 'quality_gate_failed'
        );
        return;
      }
      eligible = qualityReady;
    }

    const pools = buildPoolRuntime(freshConfig, freshRunning);
    const enabledPools = pools.filter((p) => p.config.enabled);
    if (enabledPools.length === 0) {
      this.recordIdle('no_enabled_pools');
      return;
    }

    if (enabledPools.every((p) => !p.modelAvailable)) {
      this.recordIdle('model_unavailable');
      return;
    }

    const qualityReadyDemand = Math.max(0, eligible.length - pendingSelectors);
    const starts = Math.min(
      freshConfig.supervisor.maxStartsPerTick,
      poolRefillOrder(pools, globalFree).reduce((sum, o) => sum + o.starts, 0),
      qualityReadyDemand
    );

    let spawned = 0;
    const poolMap = new Map(freshConfig.supervisor.workerPools.map((p) => [p.id, p]));
    for (const item of poolRefillOrder(pools, globalFree)) {
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

  private lastCoordinatorRunAt = 0;
  private coordinatorSpawnId: string | null = null;
  private enricherSpawnId: string | null = null;

  private hasEnricherCapacity(config: MessengerConfig, running: SpawnedAgent[]): boolean {
    return running.length < config.maxConcurrentSpawns;
  }

  private reconcileEnricher(): void {
    if (this.enricherSpawnId === null) return;
    const history = listSpawnedHistory(this.cwd, SUPERVISOR_SESSION_ID);
    const enricher = history.find((a) => a.id === this.enricherSpawnId);
    if (!enricher || enricher.status === 'running') return;
    this.enricherSpawnId = null;
  }

  private spawnEnricher(config: MessengerConfig, assessment: BeadQualityAssessment): void {
    const roleFile = resolveEnricherRoleFile(this.cwd, config.supervisor.goalRefiner.roleFile);
    if (!roleFile) {
      this.snapshot.lastError = 'automatic enricher role file not found';
      return;
    }
    const model =
      config.supervisor.goalRefiner.model.mode === 'exact'
        ? config.supervisor.goalRefiner.model.model
        : undefined;
    const record = spawnSubagent(
      this.cwd,
      {
        role: 'Goal Refiner',
        agentFile: roleFile,
        objective: automaticEnrichmentObjective(assessment),
        model,
      },
      SUPERVISOR_SESSION_ID,
      undefined
    );
    this.enricherSpawnId = record.id;
  }

  private async maybeRunIntervalCoordinator(config: MessengerConfig): Promise<void> {
    const coord = config.supervisor.coordinator;
    if (!coord.enabled || coord.mode !== 'interval') return;

    // Skip if a coordinator is still running (guard retained for child lifetime)
    if (this.coordinatorSpawnId) {
      const history = listSpawnedHistory(this.cwd, SUPERVISOR_SESSION_ID);
      const coord = history.find((a) => a.id === this.coordinatorSpawnId);
      if (coord && coord.status === 'running') return;
      this.coordinatorSpawnId = null;
    }

    const intervalMs = (coord.intervalMinutes ?? 5) * 60 * 1000;
    const now = Date.now();
    if (now - this.lastCoordinatorRunAt < intervalMs) return;

    // Trigger conditions (§19.6): at least one must be true.
    // Uses full spawn history (not just running) for failed-worker check,
    // and real br in-progress state for the no-ready-but-in-progress check.
    const fullHistory = listSpawnedHistory(this.cwd, SUPERVISOR_SESSION_ID);
    const hasFailedWorker = fullHistory.some(
      (w) => w.status === 'failed' && w.role !== 'Coordinator'
    );
    const hasRunningWorkers = fullHistory.some((w) => w.status === 'running');
    const hasInProgress = hasInProgressBeads(this.cwd);
    const readyCount = this.snapshot.lastReadyCount ?? 0;
    const hasNoReadyButInProgress = readyCount === 0 && hasRunningWorkers && hasInProgress;

    if (!hasFailedWorker && !hasNoReadyButInProgress) return;

    this.lastCoordinatorRunAt = now;
    try {
      const model = coord.model.mode === 'exact' ? coord.model.model : undefined;
      const record = spawnSubagent(
        this.cwd,
        {
          role: 'Coordinator',
          agentFile: 'agents/coordinator.md',
          objective:
            'Inspect worker pool state and send coordination messages via Agent Mail. Then exit.',
          model,
        },
        SUPERVISOR_SESSION_ID,
        undefined
      );
      this.coordinatorSpawnId = record.id;
    } catch {
      // Coordinator failure is non-fatal — does not pause refill
    }
  }

  private recordIdle(reason: SupervisorIdleReason): void {
    this.snapshot.lastReason = reason;
    this.snapshot.lastSpawnedCount = 0;
  }
}
