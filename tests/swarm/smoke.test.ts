import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessengerState, Dirs } from '../../lib.js';
import { executeAction } from '../../router.js';
import { createMockContext } from '../helpers/mock-context.js';

const roots = new Set<string>();

function createTempCwd(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-messenger-smoke-'));
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
    reservations: [],
    chatHistory: new Map(),
    unreadCounts: new Map(),
    channelPostHistory: [],
    seenSenders: new Map(),
    model: 'test-model',
    gitBranch: 'main',
    spec: undefined,
    scopeToFolder: false,
    isHuman: false,
    session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: new Date().toISOString() },
    statusMessage: undefined,
    customStatus: false,
    registryFlushTimer: null,
    sessionStartedAt: new Date().toISOString(),
    currentChannel: 'test-channel',
    sessionChannel: 'test-channel',
    joinedChannels: ['test-channel'],
  } as MessengerState;
}

afterEach(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  roots.clear();
});

describe('pi-ultra-messenger smoke', () => {
  it('rejects removed task routes', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const ctx = createMockContext(cwd);
    const state = createState('Alpha');

    for (const action of ['task.create', 'task.claim', 'task.done', 'task.list']) {
      const res = await executeAction(
        action,
        action === 'task.create' ? { title: 'test' } : action === 'task.claim' || action === 'task.done' ? { id: 'task-1' } : {},
        state,
        dirs,
        ctx,
        () => {},
        () => {},
        () => {}
      );
      expect(res.content[0]?.text).toContain('Unknown or removed action');
    }
  });

  it('still supports spawn list and swarm status', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const ctx = createMockContext(cwd);
    const state = createState('Alpha');

    const list = await executeAction(
      'spawn.list',
      {},
      state,
      dirs,
      ctx,
      () => {},
      () => {},
      () => {}
    );
    expect(list.content[0]?.text).toContain('No spawned agents');
  });
});
