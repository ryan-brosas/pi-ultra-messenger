import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessengerState, Dirs } from '../../lib.js';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../../swarm/progress.js', () => ({
  createProgress: () => ({
    tokens: 0,
    toolCallCount: 0,
    recentTools: [],
    status: 'running',
  }),
  updateProgress: () => {},
  parseJsonlLine: () => null,
}));

vi.mock('../../swarm/live-progress.js', () => ({
  removeLiveWorker: () => {},
  updateLiveWorker: () => {},
}));

import { spawnSubagent, clearSpawnStateForTests, loadSpawnedAgents, updateSpawnStatus } from '../../swarm/spawn.js';
import { executeAction } from '../../router.js';
import { createMockContext } from '../helpers/mock-context.js';

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  kill = vi.fn();
  pid = 10000 + Math.floor(Math.random() * 9999);
}

const roots = new Set<string>();

function createTempCwd(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-worker-status-'));
  roots.add(cwd);
  return cwd;
}

function createDirs(cwd: string): Dirs {
  const base = path.join(cwd, '.pi', 'messenger');
  const registry = path.join(base, 'registry');
  fs.mkdirSync(registry, { recursive: true });
  return { base, registry };
}

function createState(): MessengerState {
  return {
    agentName: '',
    registered: false,
    reservations: [],
    chatHistory: new Map(),
    unreadCounts: new Map(),
    channelPostHistory: [],
    seenSenders: new Map(),
    model: '',
    gitBranch: undefined,
    spec: undefined,
    scopeToFolder: false,
    isHuman: false,
    session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: new Date().toISOString() },
    statusMessage: undefined,
    customStatus: false,
    registryFlushTimer: null,
    sessionStartedAt: new Date().toISOString(),
    currentChannel: '',
    sessionChannel: '',
    joinedChannels: [],
  } as MessengerState;
}

afterEach(() => {
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  roots.clear();
  clearSpawnStateForTests();
});

beforeEach(() => {
  spawnMock.mockReset();
});

describe('worker status telemetry', () => {
  it('sets PI_SWARM_SPAWN_ID env var on spawn', () => {
    const cwd = createTempCwd();
    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    const agent = spawnSubagent(cwd, { role: 'Worker', objective: 'Test' }, 'test-session');

    const callArgs = spawnMock.mock.calls[0];
    const opts = callArgs[2] as { env: Record<string, string | undefined> };
    expect(opts.env.PI_SWARM_SPAWNED).toBe('1');
    expect(opts.env.PI_AGENT_NAME).toBeDefined();
    expect(opts.env.PI_SWARM_SPAWN_ID).toBe(agent.id);
  });

  it('updates spawn status via router with explicit id', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState();
    const ctx = createMockContext(cwd);
    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    const agent = spawnSubagent(cwd, { role: 'Worker', objective: 'Test' }, 'test-session');

    const res = await executeAction(
      'worker.status',
      { id: agent.id, phase: 'implementing', taskId: 'br-42', message: 'Writing tests' },
      state,
      dirs,
      ctx,
      () => {},
      () => {},
      () => {},
    );

    expect(res.content[0]?.text).toContain('Status updated');
    expect(res.details?.agent.phase).toBe('implementing');
    expect(res.details?.agent.currentBeadId).toBe('br-42');
    expect(res.details?.agent.statusMessage).toBe('Writing tests');
  });

  it('updates spawn status works without registration', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState();
    const ctx = createMockContext(cwd);
    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    const agent = spawnSubagent(cwd, { role: 'Worker', objective: 'Test' }, 'test-session');

    const res = await executeAction(
      'worker.status',
      { id: agent.id, phase: 'starting' },
      state,
      dirs,
      ctx,
      () => {},
      () => {},
      () => {},
    );

    expect(res.content[0]?.text).toContain('Status updated');
    expect(res.details?.agent.phase).toBe('starting');
  });

  it('returns not found for unknown spawn id', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState();
    const ctx = createMockContext(cwd);

    const res = await executeAction(
      'worker.status',
      { id: 'nonexistent', phase: 'idle' },
      state,
      dirs,
      ctx,
      () => {},
      () => {},
      () => {},
    );

    expect(res.content[0]?.text).toContain('not found');
  });

  it('replays telemetry fields from JSONL after restart', () => {
    const cwd = createTempCwd();
    const sessionId = 'test-replay';
    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    // Spawn a worker
    const agent = spawnSubagent(cwd, { role: 'Worker', objective: 'Test' }, sessionId);

    // Update its status (this writes a progress event to JSONL)
    updateSpawnStatus(cwd, agent.id, {
      phase: 'testing',
      currentBeadId: 'br-99',
      statusMessage: 'Running tests',
    });

    // Clear in-memory state (simulates harness restart)
    clearSpawnStateForTests();

    // Reload agents from JSONL
    const replayed = loadSpawnedAgents(cwd, sessionId);
    const found = replayed.find((a) => a.id === agent.id);

    expect(found).toBeDefined();
    expect(found!.id).toBe(agent.id);
    expect(found!.phase).toBe('testing');
    expect(found!.currentBeadId).toBe('br-99');
    expect(found!.statusMessage).toBe('Running tests');
  });
});
