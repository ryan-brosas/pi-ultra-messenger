import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as taskStore from '../../swarm/task-store.js';
import { executeAction } from '../../router.js';
import type { MessengerState, Dirs } from '../../lib.js';
import { createMockContext } from '../helpers/mock-context.js';

const roots = new Set<string>();
const TEST_SESSION = 'test-session-stalled';
const TEST_CHANNEL = 'test-channel';

function createTempCwd(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-messenger-stalled-test-'));
  roots.add(cwd);
  return cwd;
}

function createDirs(cwd: string): Dirs {
  const base = path.join(cwd, '.pi', 'messenger');
  const registry = path.join(base, 'registry');
  fs.mkdirSync(registry, { recursive: true });
  return { base, registry };
}

function createState(agentName: string): MessengerState {
  return {
    agentName,
    registered: true,
    watcher: null,
    watcherRetries: 0,
    watcherRetryTimer: null,
    watcherDebounceTimer: null,
    reservations: [],
    chatHistory: new Map(),
    unreadCounts: new Map(),
    channelPostHistory: [],
    seenSenders: new Map(),
    model: 'test-model',
    gitBranch: 'main',
    spec: undefined,
    scopeToFolder: false,
    contextSessionId: TEST_SESSION,
    isHuman: false,
    session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: new Date().toISOString() },
    statusMessage: undefined,
    customStatus: false,
    registryFlushTimer: null,
    sessionStartedAt: new Date().toISOString(),
    currentChannel: 'test-channel',
    sessionChannel: 'test-channel',
    joinedChannels: ['test-channel', 'memory'],
  } as MessengerState;
}

afterEach(() => {
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.clear();
});

describe('swarm/task-store getStalledTasks', () => {
  it('returns empty when no tasks are in_progress', () => {
    const cwd = createTempCwd();
    taskStore.createTask(cwd, TEST_SESSION, { title: 'Todo task' }, TEST_CHANNEL);

    const stalled = taskStore.getStalledTasks(cwd, TEST_SESSION, 0);
    expect(stalled).toEqual([]);
  });

  it('returns empty when task was recently claimed', () => {
    const cwd = createTempCwd();
    const task = taskStore.createTask(cwd, TEST_SESSION, { title: 'Active task' }, TEST_CHANNEL);
    taskStore.claimTask(cwd, TEST_SESSION, task.id, 'AgentA');

    // Default threshold is 10min, just-claimed should not be stalled
    const stalled = taskStore.getStalledTasks(cwd, TEST_SESSION);
    expect(stalled).toEqual([]);
  });

  it('returns task when claim is older than threshold', () => {
    const cwd = createTempCwd();
    const task = taskStore.createTask(cwd, TEST_SESSION, { title: 'Old task' }, TEST_CHANNEL);
    taskStore.claimTask(cwd, TEST_SESSION, task.id, 'AgentA');

    // 0ms threshold — anything in_progress is stalled
    const stalled = taskStore.getStalledTasks(cwd, TEST_SESSION, 0);
    expect(stalled).toHaveLength(1);
    expect(stalled[0].id).toBe(task.id);
  });

  it('uses progress_log last entry as activity timestamp when present', () => {
    const cwd = createTempCwd();
    const task = taskStore.createTask(cwd, TEST_SESSION, { title: 'Progress task' }, TEST_CHANNEL);
    taskStore.claimTask(cwd, TEST_SESSION, task.id, 'AgentA');

    // Progress was written — use 0ms threshold so it's immediately stalled
    taskStore.appendTaskProgress(cwd, TEST_SESSION, task.id, 'AgentA', 'Working on it');
    const stalled = taskStore.getStalledTasks(cwd, TEST_SESSION, 0);
    expect(stalled).toHaveLength(1);
    expect(stalled[0].id).toBe(task.id);
  });

  it('does not return task with recent progress within threshold', () => {
    const cwd = createTempCwd();
    const task = taskStore.createTask(
      cwd,
      TEST_SESSION,
      { title: 'Recent progress' },
      TEST_CHANNEL
    );
    taskStore.claimTask(cwd, TEST_SESSION, task.id, 'AgentA');
    taskStore.appendTaskProgress(cwd, TEST_SESSION, task.id, 'AgentA', 'Just updated');

    // 10-minute threshold — just-updated should not be stalled
    const stalled = taskStore.getStalledTasks(cwd, TEST_SESSION, 10 * 60 * 1000);
    expect(stalled).toEqual([]);
  });

  it('ignores done tasks regardless of age', () => {
    const cwd = createTempCwd();
    const task = taskStore.createTask(cwd, TEST_SESSION, { title: 'Done task' }, TEST_CHANNEL);
    taskStore.claimTask(cwd, TEST_SESSION, task.id, 'AgentA');
    taskStore.completeTask(cwd, TEST_SESSION, task.id, 'AgentA', 'Finished');

    const stalled = taskStore.getStalledTasks(cwd, TEST_SESSION, 0);
    expect(stalled).toEqual([]);
  });

  it('ignores blocked tasks regardless of age', () => {
    const cwd = createTempCwd();
    const task = taskStore.createTask(cwd, TEST_SESSION, { title: 'Blocked task' }, TEST_CHANNEL);
    taskStore.claimTask(cwd, TEST_SESSION, task.id, 'AgentA');
    taskStore.blockTask(cwd, TEST_SESSION, task.id, 'AgentA', 'Waiting on API key');

    const stalled = taskStore.getStalledTasks(cwd, TEST_SESSION, 0);
    expect(stalled).toEqual([]);
  });

  it('returns multiple stalled tasks sorted by id', () => {
    const cwd = createTempCwd();
    const taskA = taskStore.createTask(cwd, TEST_SESSION, { title: 'First' }, TEST_CHANNEL);
    const taskB = taskStore.createTask(cwd, TEST_SESSION, { title: 'Second' }, TEST_CHANNEL);
    taskStore.claimTask(cwd, TEST_SESSION, taskA.id, 'AgentA');
    taskStore.claimTask(cwd, TEST_SESSION, taskB.id, 'AgentB');

    const stalled = taskStore.getStalledTasks(cwd, TEST_SESSION, 0);
    expect(stalled).toHaveLength(2);
    expect(stalled.map((t) => t.id)).toEqual([taskA.id, taskB.id]);
  });
});

describe('router rejects removed task.stalled route', () => {
  it('rejects task.stalled as removed', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentStalled');
    const ctx = createMockContext(cwd);

    const res = await executeAction(
      'task.stalled',
      {},
      state,
      dirs,
      ctx,
      () => {},
      () => {},
      () => {}
    );

    expect(res.content[0]?.text).toContain('Unknown or removed action');
    expect(res.content[0]?.text).toContain('task');
  });
});
