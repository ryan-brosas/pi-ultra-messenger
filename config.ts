/**
 * Pi Messenger - Configuration
 *
 * Priority (highest to lowest):
 * 1. Project: .pi/pi-messenger.json
 * 2. Extension-specific: ~/.pi/agent/pi-messenger.json
 * 3. Main settings: ~/.pi/agent/settings.json → "messenger" key
 * 4. Defaults
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

export type PiModelSelection =
  | { mode: 'inherit' }
  | { mode: 'exact'; model: string };

export interface WorkerPoolConfig {
  id: string;
  workers: number;
  model: PiModelSelection;
  roleFile?: string;
  enabled: boolean;
}

export interface CoordinatorConfig {
  enabled: boolean;
  model: PiModelSelection;
  roleFile?: string;
  mode: 'manual' | 'interval';
  intervalMinutes?: number;
}

export interface GoalRefinerConfig {
  enabled: boolean;
  model: PiModelSelection;
  roleFile?: string;
  mode: 'manual';
}

export interface SupervisorConfig {
  enabled: boolean;
  paused: boolean;
  pollIntervalMs: number;
  maxStartsPerTick: number;
  workerPools: WorkerPoolConfig[];
  coordinator: CoordinatorConfig;
  goalRefiner: GoalRefinerConfig;
}

export interface MessengerConfig {
  autoRegister: boolean;
  autoRegisterPaths: string[];
  scopeToFolder: boolean;
  contextMode: 'full' | 'minimal' | 'none';
  registrationContext: boolean;
  replyHint: boolean;
  senderDetailsOnFirstContact: boolean;
  nameTheme: string;
  nameWords?: { adjectives: string[]; nouns: string[] };
  feedRetention: number;
  stuckThreshold: number;
  stuckNotify: boolean;
  autoStatus: boolean;
  autoOverlay: boolean;
  swarmEventsInFeed: boolean;
  maxConcurrentSpawns: number;
  supervisor: SupervisorConfig;
}
const DEFAULT_SUPERVISOR: SupervisorConfig = {
  enabled: false,
  paused: false,
  pollIntervalMs: 15_000,
  maxStartsPerTick: 2,
  workerPools: [
    {
      id: 'default',
      workers: 3,
      model: { mode: 'inherit' },
      enabled: true,
    },
  ],
  coordinator: {
    enabled: false,
    model: { mode: 'inherit' },
    mode: 'manual',
  },
  goalRefiner: {
    enabled: false,
    model: { mode: 'inherit' },
    mode: 'manual',
  },
};

const DEFAULT_CONFIG: MessengerConfig = {
  autoRegister: false,
  autoRegisterPaths: [],
  scopeToFolder: true,
  contextMode: 'full',
  registrationContext: true,
  replyHint: true,
  senderDetailsOnFirstContact: true,
  nameTheme: 'default',
  feedRetention: 50,
  stuckThreshold: 900,
  stuckNotify: true,
  autoStatus: true,
  autoOverlay: true,
  swarmEventsInFeed: true,
  maxConcurrentSpawns: 3,
  supervisor: DEFAULT_SUPERVISOR,
};


function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return join(getAgentDir(), '..', p.slice(2));
  }
  return p;
}

export function matchesAutoRegisterPath(cwd: string, paths: string[]): boolean {
  const normalizedCwd = cwd.replace(/\/+$/, ''); // Remove trailing slashes

  for (const pattern of paths) {
    const expanded = expandHome(pattern).replace(/\/+$/, '');

    // Simple glob support: trailing /* matches any subdirectory
    if (expanded.endsWith('/*')) {
      const base = expanded.slice(0, -2);
      if (normalizedCwd === base || normalizedCwd.startsWith(base + '/')) {
        return true;
      }
    } else if (expanded.endsWith('*')) {
      // Prefix match: /path/prefix* matches /path/prefix-anything
      const prefix = expanded.slice(0, -1);
      if (normalizedCwd.startsWith(prefix)) {
        return true;
      }
    } else {
      // Exact match
      if (normalizedCwd === expanded) {
        return true;
      }
    }
  }

  return false;
}

export function saveAutoRegisterPaths(paths: string[]): void {
  const configPath = join(getAgentDir(), 'pi-messenger.json');
  let existing: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      // Start fresh if malformed
    }
  }

  existing.autoRegisterPaths = paths;

  const dir = getAgentDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(existing, null, 2));
}

export function getAutoRegisterPaths(): string[] {
  const configPath = join(getAgentDir(), 'pi-messenger.json');
  if (!existsSync(configPath)) return [];

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return Array.isArray(config.autoRegisterPaths) ? config.autoRegisterPaths : [];
  } catch {
    return [];
  }
}

function mergeSupervisor(sup?: Partial<SupervisorConfig>): SupervisorConfig {
  if (!sup) return DEFAULT_SUPERVISOR;
  return {
    enabled: sup.enabled === true,
    paused: sup.paused === true,
    pollIntervalMs: typeof sup.pollIntervalMs === 'number' && sup.pollIntervalMs > 0 ? sup.pollIntervalMs : DEFAULT_SUPERVISOR.pollIntervalMs,
    maxStartsPerTick: typeof sup.maxStartsPerTick === 'number' && sup.maxStartsPerTick > 0 ? sup.maxStartsPerTick : DEFAULT_SUPERVISOR.maxStartsPerTick,
    workerPools: Array.isArray(sup.workerPools) && sup.workerPools.length > 0
      ? sup.workerPools.map((p, i) => ({
          id: p.id || `pool-${i}`,
          workers: typeof p.workers === 'number' ? p.workers : 3,
          model: p.model || { mode: 'inherit' },
          roleFile: p.roleFile,
          enabled: p.enabled !== false,
        }))
      : DEFAULT_SUPERVISOR.workerPools,
    coordinator: sup.coordinator
      ? {
          enabled: sup.coordinator.enabled === true,
          model: sup.coordinator.model || { mode: 'inherit' },
          roleFile: sup.coordinator.roleFile,
          mode: sup.coordinator.mode || 'manual',
          intervalMinutes: sup.coordinator.intervalMinutes,
        }
      : DEFAULT_SUPERVISOR.coordinator,
    goalRefiner: sup.goalRefiner
      ? {
          enabled: sup.goalRefiner.enabled === true,
          model: sup.goalRefiner.model || { mode: 'inherit' },
          roleFile: sup.goalRefiner.roleFile,
          mode: 'manual',
        }
      : DEFAULT_SUPERVISOR.goalRefiner,
  };
}

export function loadConfig(cwd: string): MessengerConfig {
  const projectPath = join(cwd, '.pi', 'pi-messenger.json');
  const extensionGlobalPath = join(getAgentDir(), 'pi-messenger.json');
  const mainSettingsPath = join(getAgentDir(), 'settings.json');

  // Load from main settings.json (lowest priority of the three sources)
  let settingsConfig: Partial<MessengerConfig> = {};
  const mainSettings = readJsonFile(mainSettingsPath);
  if (
    mainSettings &&
    typeof mainSettings.messenger === 'object' &&
    mainSettings.messenger !== null
  ) {
    settingsConfig = mainSettings.messenger as Partial<MessengerConfig>;
  }

  // Load extension-specific global config
  const extensionConfig = readJsonFile(extensionGlobalPath) as Partial<MessengerConfig> | null;

  // Load project config (highest priority)
  const projectConfig = readJsonFile(projectPath) as Partial<MessengerConfig> | null;

  const merged = {
    ...DEFAULT_CONFIG,
    ...settingsConfig,
    ...(extensionConfig ?? {}),
    ...(projectConfig ?? {}),
  };

  const nameWords = (merged as Record<string, unknown>).nameWords as
    | { adjectives: string[]; nouns: string[] }
    | undefined;

  const sharedFields = {
    nameTheme: typeof merged.nameTheme === 'string' ? merged.nameTheme : DEFAULT_CONFIG.nameTheme,
    nameWords:
      nameWords && Array.isArray(nameWords.adjectives) && Array.isArray(nameWords.nouns)
        ? nameWords
        : undefined,
    feedRetention:
      typeof merged.feedRetention === 'number'
        ? merged.feedRetention
        : DEFAULT_CONFIG.feedRetention,
    stuckThreshold:
      typeof merged.stuckThreshold === 'number'
        ? merged.stuckThreshold
        : DEFAULT_CONFIG.stuckThreshold,
    stuckNotify: merged.stuckNotify !== false,
    autoStatus: merged.autoStatus !== false,
    autoOverlay: merged.autoOverlay !== false,
    swarmEventsInFeed: (merged as Record<string, unknown>).swarmEventsInFeed !== false,
    maxConcurrentSpawns:
      typeof merged.maxConcurrentSpawns === 'number' && merged.maxConcurrentSpawns > 0
        ? merged.maxConcurrentSpawns
        : DEFAULT_CONFIG.maxConcurrentSpawns,
    supervisor: mergeSupervisor(merged.supervisor),
  };

  if (merged.contextMode === 'none') {
    return {
      autoRegister: merged.autoRegister === true,
      autoRegisterPaths: Array.isArray(merged.autoRegisterPaths) ? merged.autoRegisterPaths : [],
      scopeToFolder: merged.scopeToFolder === true,
      contextMode: 'none',
      registrationContext: false,
      replyHint: false,
      senderDetailsOnFirstContact: false,
      ...sharedFields,
    };
  }

  if (merged.contextMode === 'minimal') {
    return {
      autoRegister: merged.autoRegister === true,
      autoRegisterPaths: Array.isArray(merged.autoRegisterPaths) ? merged.autoRegisterPaths : [],
      scopeToFolder: merged.scopeToFolder === true,
      contextMode: 'minimal',
      registrationContext: false,
      replyHint: true,
      senderDetailsOnFirstContact: false,
      ...sharedFields,
    };
  }

  return {
    autoRegister: merged.autoRegister === true,
    autoRegisterPaths: Array.isArray(merged.autoRegisterPaths) ? merged.autoRegisterPaths : [],
    scopeToFolder: merged.scopeToFolder === true,
    contextMode: 'full',
    registrationContext: merged.registrationContext !== false,
    replyHint: merged.replyHint !== false,
    senderDetailsOnFirstContact: merged.senderDetailsOnFirstContact !== false,
    ...sharedFields,
  };
}
