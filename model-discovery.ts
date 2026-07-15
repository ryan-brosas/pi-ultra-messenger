/**
 * Pi model discovery — minimal RPC probe with cached inventory.
 *
 * Calls `pi --list-models` once and caches the result. Used by setup
 * to validate model selections and by the supervisor to check
 * per-pool model availability.
 */

import { execSync } from 'node:child_process';

export interface PiModelInfo {
  provider: string;
  model: string;
  context: string;
  maxOut: string;
  thinking: boolean;
  images: boolean;
}

let cachedInventory: PiModelInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Parse `pi --list-models` output into structured model info.
 */
function parseModelOutput(output: string): PiModelInfo[] {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return [];

  // Skip header line
  const models: PiModelInfo[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 6) continue;

    const provider = parts[0];
    const model = parts[1];
    if (!provider || !model) continue;

    models.push({
      provider,
      model,
      context: parts[2] || '',
      maxOut: parts[3] || '',
      thinking: parts[4] === 'yes',
      images: parts[5] === 'yes',
    });
  }
  return models;
}

/**
 * Get the cached model inventory, probing Pi if the cache is stale or empty.
 */
export function getModelInventory(): PiModelInfo[] {
  const now = Date.now();
  if (cachedInventory && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedInventory;
  }

  try {
    const output = execSync('pi --list-models', {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    cachedInventory = parseModelOutput(output);
    cacheTimestamp = now;
    return cachedInventory;
  } catch {
    // If Pi is not available, return empty inventory
    return cachedInventory ?? [];
  }
}

/**
 * Force-refresh the cache (e.g. after a config change).
 */
export function refreshModelInventory(): PiModelInfo[] {
  cachedInventory = null;
  return getModelInventory();
}

/**
 * Check if a model string (e.g. "anthropic/claude-sonnet-5") is available.
 */
export function isModelAvailable(modelId: string): boolean {
  const inventory = getModelInventory();
  const slash = modelId.indexOf('/');
  if (slash === -1) return inventory.some((m) => m.model === modelId);
  const provider = modelId.slice(0, slash);
  const model = modelId.slice(slash + 1);
  return inventory.some((m) => m.provider === provider && m.model === model);
}

/**
 * Validate a model selection, returning an error message if invalid.
 */
export function validateModelSelection(model: string): string | null {
  if (model === 'inherit') return null;
  if (!isModelAvailable(model)) {
    return `Model "${model}" is not available. Run 'pi --list-models' to see visible models.`;
  }
  return null;
}

/**
 * Get the full model ID string from provider and model.
 */
export function modelId(provider: string, model: string): string {
  return `${provider}/${model}`;
}
