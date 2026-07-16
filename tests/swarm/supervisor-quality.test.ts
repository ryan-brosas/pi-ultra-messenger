import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessengerConfig, SupervisorConfig } from '../../config.js';

const spawnMock = vi.hoisted(() => vi.fn());
const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  execSync: execSyncMock,
}));

vi.mock('../../swarm/progress.js', () => ({
  createProgress: () => ({ tokens: 0, toolCallCount: 0, recentTools: [], status: 'running' }),
  updateProgress: () => {},
  parseJsonlLine: () => null,
}));

vi.mock('../../swarm/live-progress.js', () => ({
  removeLiveWorker: () => {},
  updateLiveWorker: () => {},
  getLiveWorkers: () => new Map(),
  onLiveWorkersChanged: () => {},
}));

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn();
  pid = process.pid;
}

import {
  ProjectSupervisor,
  SUPERVISOR_SESSION_ID,
  assessBeadQuality,
  normalizeReadyBeads,
  ENRICHMENT_MARKER,
  type ReadyBead,
} from '../../swarm/supervisor.js';
import { spawnSubagent, clearSpawnStateForTests } from '../../swarm/spawn.js';

const roots = new Set<string>();

function createTempCwd(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-quality-'));
  roots.add(cwd);
  return cwd;
}

function thinBead(id: string): ReadyBead {
  return {
    id,
    title: 'Build Atlas Notes',
    description: 'Build the app.',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    dependencyCount: 0,
    labels: [],
  };
}

function richBead(id: string): ReadyBead {
  return {
    id,
    title: 'Implement document upload API',
    description: [
      ENRICHMENT_MARKER,
      '',
      '## Context and Rationale',
      'Users need to upload team notes for downstream indexing.',
      '',
      '## Outcome',
      'A multipart upload endpoint that accepts PDFs and markdown.',
      '',
      '## Scope and Boundaries',
      'Scope: upload only. Non-goals: parsing, indexing, search UI.',
      '',
      '## Acceptance Criteria',
      'Reject malware, cap retries, persist parse status, record timing.',
      '',
      '## Failure Modes and Recovery',
      'Retry exhaustion rolls back; malformed PDFs are quarantined.',
      '',
      '## Dependencies',
      'Depends on the storage primitive bead.',
      '',
      '## Implementation Notes',
      'Affected files: src/upload/*. Streaming chunked uploads.',
      '',
      '## Verification Plan',
      'Unit tests for malformed PDFs; e2e for retry exhaustion and resume.',
    ].join('\n'),
    design: '',
    acceptanceCriteria: '',
    notes: '',
    dependencyCount: 1,
    labels: ['backend'],
  };
}

afterEach(() => {
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.clear();
  clearSpawnStateForTests();
});

beforeEach(() => {
  spawnMock.mockReset();
  execSyncMock.mockReset();
  execSyncMock.mockImplementation(() => '[]');
});

function makeConfig(overrides: Partial<SupervisorConfig> = {}): MessengerConfig {
  return {
    autoRegister: false,
    autoRegisterPaths: [],
    scopeToFolder: true,
    contextMode: 'full',
    registrationContext: false,
    replyHint: false,
    senderDetailsOnFirstContact: false,
    nameTheme: 'default',
    feedRetention: 50,
    stuckThreshold: 900,
    stuckNotify: false,
    autoStatus: false,
    autoOverlay: false,
    swarmEventsInFeed: false,
    maxConcurrentSpawns: 5,
    supervisor: {
      enabled: true,
      paused: false,
      pollIntervalMs: 100,
      maxStartsPerTick: 2,
      workerPools: [{ id: 'default', workers: 3, model: { mode: 'inherit' }, enabled: true }],
      coordinator: { enabled: false, model: { mode: 'inherit' }, mode: 'manual' },
      goalRefiner: {
        enabled: false,
        model: { mode: 'inherit' },
        mode: 'manual',
        minimumQualityScore: 75,
      },
      ...overrides,
    },
  };
}

function setupProject(cwd: string, config: MessengerConfig): void {
  fs.mkdirSync(path.join(cwd, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.pi', 'pi-messenger.json'), JSON.stringify(config));
  fs.mkdirSync(path.join(cwd, 'agents'), { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, '..', '..', 'agents', 'goal-refiner.md'),
    path.join(cwd, 'agents', 'goal-refiner.md')
  );
}

function systemPromptOf(call: unknown[]): string {
  const args = call[1] as string[];
  const idx = args.indexOf('--append-system-prompt');
  if (idx === -1 || idx + 1 >= args.length) return '';
  try {
    return fs.readFileSync(args[idx + 1], 'utf-8');
  } catch {
    return '';
  }
}

function objectiveOf(call: unknown[]): string {
  const args = call[1] as string[];
  return typeof args[args.length - 1] === 'string' ? (args[args.length - 1] as string) : '';
}

function isEnricherCall(call: unknown[]): boolean {
  return (
    objectiveOf(call).includes('AUTO-ENRICH') || systemPromptOf(call).includes('Goal Refiner Role')
  );
}

function isWorkerCall(call: unknown[]): boolean {
  const sp = systemPromptOf(call);
  return sp.includes('Worker Role') && !sp.includes('Goal Refiner Role');
}

describe('normalizeReadyBeads captures enrichment fields', () => {
  it('reads description, acceptance criteria, and dependency count', () => {
    const raw = [
      {
        id: 'pum-1',
        title: 'Test',
        description: 'desc body',
        acceptance_criteria: 'done when x',
        dependencies: ['pum-0'],
        labels: ['backend'],
      },
    ];
    const beads = normalizeReadyBeads(raw);
    expect(beads[0].description).toBe('desc body');
    expect(beads[0].acceptanceCriteria).toBe('done when x');
    expect(beads[0].dependencyCount).toBe(1);
  });
});

describe('assessBeadQuality', () => {
  it('scores a thin bead below threshold and lists missing criteria', () => {
    const a = assessBeadQuality(thinBead('pum-1'), 75);
    expect(a.score).toBeLessThan(75);
    expect(a.passes).toBe(false);
    expect(a.missingCriteria.length).toBeGreaterThan(0);
    expect(a.alreadyEnriched).toBe(false);
  });

  it('passes a context-rich bead that hits threshold and required criteria', () => {
    const a = assessBeadQuality(richBead('pum-2'), 75);
    expect(a.score).toBeGreaterThanOrEqual(75);
    expect(a.passes).toBe(true);
    expect(a.alreadyEnriched).toBe(true);
  });

  it('treats already-enriched beads as alreadyEnriched even if still thin', () => {
    const enrichedButThin: ReadyBead = {
      ...thinBead('pum-3'),
      description: `${ENRICHMENT_MARKER}\nshort`,
    };
    const a = assessBeadQuality(enrichedButThin, 75);
    expect(a.alreadyEnriched).toBe(true);
  });
});

describe('supervisor automatic quality gate', () => {
  it('spawns an enricher for a thin bead and does not spawn a worker', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({
      goalRefiner: {
        enabled: true,
        model: { mode: 'exact', model: 'openai-codex/gpt-5.6-sol:medium' },
        mode: 'automatic',
        minimumQualityScore: 75,
      },
    });
    setupProject(cwd, config);

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('br ready')) {
        return JSON.stringify([thinBead('pum-thin')]);
      }
      return '[]';
    });

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');

    const enricherCall = spawnMock.mock.calls.find((c: unknown[]) =>
      objectiveOf(c).includes('AUTO-ENRICH pum-thin')
    );
    expect(enricherCall).toBeTruthy();

    const workerCalls = spawnMock.mock.calls.filter((c: unknown[]) => isWorkerCall(c));
    expect(workerCalls).toHaveLength(0);
  });

  it('spawns a worker for a quality-approved bead without enriching', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({
      goalRefiner: {
        enabled: true,
        model: { mode: 'exact', model: 'openai-codex/gpt-5.6-sol:medium' },
        mode: 'automatic',
        minimumQualityScore: 75,
      },
    });
    setupProject(cwd, config);

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('br ready')) {
        return JSON.stringify([richBead('pum-rich')]);
      }
      return '[]';
    });

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');

    const enricherCalls = spawnMock.mock.calls.filter((c: unknown[]) =>
      objectiveOf(c).includes('AUTO-ENRICH')
    );
    expect(enricherCalls).toHaveLength(0);

    const workerCalls = spawnMock.mock.calls.filter((c: unknown[]) => isWorkerCall(c));
    expect(workerCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not spawn a second enricher while one is already running', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({
      goalRefiner: {
        enabled: true,
        model: { mode: 'exact', model: 'openai-codex/gpt-5.6-sol:medium' },
        mode: 'automatic',
        minimumQualityScore: 75,
      },
    });
    setupProject(cwd, config);

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('br ready')) {
        return JSON.stringify([thinBead('pum-a'), thinBead('pum-b')]);
      }
      return '[]';
    });

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');
    const firstCount = spawnMock.mock.calls.filter((c: unknown[]) =>
      objectiveOf(c).includes('AUTO-ENRICH')
    ).length;
    expect(firstCount).toBe(1);

    // Second tick while enricher still running — no new enricher spawn
    await sup.requestTick('test');
    const secondCount = spawnMock.mock.calls.filter((c: unknown[]) =>
      objectiveOf(c).includes('AUTO-ENRICH')
    ).length;
    expect(secondCount).toBe(1);
  });

  it('does not enrich an already-enriched thin bead', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({
      goalRefiner: {
        enabled: true,
        model: { mode: 'exact', model: 'openai-codex/gpt-5.6-sol:medium' },
        mode: 'automatic',
        minimumQualityScore: 75,
      },
    });
    setupProject(cwd, config);

    const enrichedButThin: ReadyBead = {
      ...thinBead('pum-e'),
      description: `${ENRICHMENT_MARKER}\nstill short`,
    };

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('br ready')) return JSON.stringify([enrichedButThin]);
      return '[]';
    });

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');

    const enricherCalls = spawnMock.mock.calls.filter((c: unknown[]) =>
      objectiveOf(c).includes('AUTO-ENRICH')
    );
    expect(enricherCalls).toHaveLength(0);

    const snapshot = sup.getSnapshot();
    expect(snapshot.lastReason).toBe('quality_gate_failed');
  });

  it('ignores the quality gate when the refiner is disabled', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({
      goalRefiner: {
        enabled: false,
        model: { mode: 'inherit' },
        mode: 'manual',
        minimumQualityScore: 75,
      },
    });
    setupProject(cwd, config);

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('br ready')) return JSON.stringify([thinBead('pum-plain')]);
      return '[]';
    });

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');

    const workerCalls = spawnMock.mock.calls.filter((c: unknown[]) => isWorkerCall(c));
    expect(workerCalls.length).toBeGreaterThanOrEqual(1);
  });
});
