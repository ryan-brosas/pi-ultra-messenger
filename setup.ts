/**
 * Setup wizard and pool management for pi-ultra-messenger.
 *
 * Interactive and non-interactive configuration of worker pools,
 * model discovery validation, and safe project config write.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { getModelInventory, isModelAvailable, validateModelSelection } from './model-discovery.js';
import type {
  MessengerConfig,
  SupervisorConfig,
  WorkerPoolConfig,
  PiModelSelection,
} from './config.js';

/**
 * Parse --worker 'model=count' flags into pool configs.
 */
export function parseWorkerFlags(workers: string[]): WorkerPoolConfig[] {
  return workers.map((w, i) => {
    const eq = w.lastIndexOf('=');
    if (eq === -1) {
      throw new Error(
        `Invalid --worker format: "${w}". Expected '<model>=<count>' (e.g. 'anthropic/claude-sonnet-5=6').`
      );
    }
    const model = w.slice(0, eq).trim();
    const count = parseInt(w.slice(eq + 1).trim(), 10);
    if (isNaN(count) || count < 0) {
      throw new Error(`Invalid worker count in "${w}". Expected a non-negative integer.`);
    }
    const selection: PiModelSelection =
      model === 'inherit' ? { mode: 'inherit' } : { mode: 'exact', model };
    return {
      id: `pool-${i}`,
      workers: count,
      model: selection,
      enabled: true,
    };
  });
}

/**
 * Validate all pool models against Pi's inventory.
 * Returns null if all valid, or an error message.
 */
export function validatePools(pools: WorkerPoolConfig[]): string | null {
  const inventory = getModelInventory();
  if (inventory.length === 0) {
    return 'No Pi models discovered. Run "pi --list-models" to verify your Pi installation.';
  }

  for (const pool of pools) {
    if (pool.model.mode === 'inherit') continue;
    const err = validateModelSelection(pool.model.model);
    if (err) return err;
  }
  return null;
}

/**
 * Build a supervisor config from pool specs.
 */
export function buildSupervisorConfig(
  pools: WorkerPoolConfig[],
  maxConcurrent?: number,
  coordinatorModel?: string
): SupervisorConfig {
  return {
    enabled: true,
    paused: false,
    pollIntervalMs: 15_000,
    maxStartsPerTick: 2,
    workerPools: pools,
    coordinator: {
      enabled: !!coordinatorModel,
      model: coordinatorModel ? { mode: 'exact', model: coordinatorModel } : { mode: 'inherit' },
      mode: 'manual',
    },
    goalRefiner: {
      enabled: false,
      model: { mode: 'inherit' },
      mode: 'manual',
      minimumQualityScore: 75,
    },
  };
}

/**
 * Write project config safely (.pi/pi-messenger.json).
 */
export function writeProjectConfig(cwd: string, config: Partial<MessengerConfig>): void {
  const configPath = path.join(cwd, '.pi', 'pi-messenger.json');

  // Merge with existing config
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // If corrupt, start fresh
    }
  }

  const merged = { ...existing, ...config };
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

/**
 * Non-interactive setup.
 */
export function setupNonInteractive(
  cwd: string,
  workers: string[],
  maxConcurrent?: number,
  coordinatorModel?: string,
  dryRun = false
): { config: SupervisorConfig; errors: string[] } {
  const errors: string[] = [];

  let pools: WorkerPoolConfig[];
  try {
    pools = parseWorkerFlags(workers);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return { config: buildSupervisorConfig([], maxConcurrent), errors };
  }

  const validationError = validatePools(pools);
  if (validationError) {
    errors.push(validationError);
    return { config: buildSupervisorConfig(pools, maxConcurrent), errors };
  }

  const supervisor = buildSupervisorConfig(pools, maxConcurrent, coordinatorModel);

  if (!dryRun) {
    writeProjectConfig(cwd, { supervisor, maxConcurrentSpawns: maxConcurrent ?? 10 });
  }

  return { config: supervisor, errors };
}

/**
 * Interactive setup wizard (stdin/stdout).
 */
export async function setupInteractive(
  cwd: string
): Promise<{ config: SupervisorConfig; errors: string[] }> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  const inventory = getModelInventory();
  console.log('\npi-ultra-messenger setup');
  console.log(`Project: ${cwd}`);
  console.log(`AGENTS.md: ${existsSync(path.join(cwd, 'AGENTS.md')) ? 'found' : 'not found'}`);
  console.log(`Pi models: ${inventory.length} visible\n`);

  if (inventory.length === 0) {
    rl.close();
    return { config: buildSupervisorConfig([]), errors: ['No Pi models discovered.'] };
  }

  // Show available models
  console.log('Available models:');
  for (const m of inventory.slice(0, 10)) {
    console.log(`  ${m.provider}/${m.model}`);
  }
  if (inventory.length > 10) {
    console.log(`  ... and ${inventory.length - 10} more (run 'pi --list-models' for full list)`);
  }
  console.log('');

  const pools: WorkerPoolConfig[] = [];
  let addMore = true;
  let poolIdx = 0;

  while (addMore) {
    const modelInput = await ask(
      `Pool ${poolIdx + 1} model (or 'inherit' for Pi's current model): `
    );
    const trimmed = modelInput.trim() || 'inherit';

    if (trimmed !== 'inherit' && !isModelAvailable(trimmed)) {
      console.log(`Error: "${trimmed}" is not available. Please choose from the list above.`);
      continue;
    }

    const countInput = await ask('Number of workers: ');
    const count = parseInt(countInput.trim(), 10);
    if (isNaN(count) || count < 0) {
      console.log('Error: must be a non-negative integer.');
      continue;
    }

    pools.push({
      id: `pool-${poolIdx}`,
      workers: count,
      model: trimmed === 'inherit' ? { mode: 'inherit' } : { mode: 'exact', model: trimmed },
      enabled: true,
    });
    poolIdx++;

    const more = await ask('Add another pool? (y/N): ');
    addMore = more.trim().toLowerCase() === 'y';
  }

  const maxInput = await ask('Global maximum concurrent spawns (default: 10): ');
  const maxConcurrent = parseInt(maxInput.trim(), 10) || 10;

  const coordinatorInput = await ask('Enable coordinator? Enter model or leave empty: ');
  const coordinatorModel = coordinatorInput.trim() || undefined;

  const startInput = await ask('Start now? (y/N): ');
  const shouldStart = startInput.trim().toLowerCase() === 'y';

  rl.close();

  const supervisor = buildSupervisorConfig(pools, maxConcurrent, coordinatorModel);
  writeProjectConfig(cwd, { supervisor, maxConcurrentSpawns: maxConcurrent });

  if (shouldStart) {
    console.log(
      '\nStarting supervisor... (use "pi-ultra-messenger supervisor start" after this setup)'
    );
  }

  console.log('\nConfiguration written to .pi/pi-messenger.json');
  return { config: supervisor, errors: [] };
}
