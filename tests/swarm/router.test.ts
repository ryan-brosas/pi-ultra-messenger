import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessengerState, Dirs } from '../../lib.js';
import { executeAction } from '../../router.js';
import { createMockContext } from '../helpers/mock-context.js';

const roots = new Set<string>();

function createTempCwd(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-messenger-router-'));
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
    contextSessionId: undefined,
    currentChannel: '',
    sessionChannel: '',
    joinedChannels: [],
  } as MessengerState;
}

function createUnregisteredState(): MessengerState {
  return {
    ...createState('Unregistered'),
    registered: false,
    agentName: '',
  } as MessengerState;
}

afterEach(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  roots.clear();
});

async function callRouter(
  action: string,
  params: Record<string, unknown>,
  cwd: string,
  dirs: Dirs,
  state: MessengerState
) {
  return executeAction(
    action,
    params,
    state,
    dirs,
    createMockContext(cwd),
    () => {},
    () => {},
    () => {}
  );
}

describe('pi-ultra-messenger router', () => {
  it('rejects task.create as removed', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentOne');

    const res = await callRouter('task.create', { title: 'Fix login' }, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Unknown or removed action');
    expect(res.content[0]?.text).toContain('task');
  });

  it('rejects task.claim as removed', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentOne');

    const res = await callRouter('task.claim', { id: 'task-1' }, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Unknown or removed action');
  });

  it('rejects claim alias as removed', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentAlias');

    const res = await callRouter('claim', { taskId: 'task-1' }, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Unknown or removed action');
  });

  it('rejects send as removed', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentSend');

    const res = await callRouter('send', { to: 'AgentB', message: 'hello' }, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Unknown or removed action');
    expect(res.content[0]?.text).toContain('send');
  });

  it('rejects feed as removed', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentFeed');

    const res = await callRouter('feed', { limit: 10 }, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Unknown or removed action');
    expect(res.content[0]?.text).toContain('feed');
  });

  it('rejects reserve as removed', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentReserve');

    const res = await callRouter('reserve', { paths: ['src/'] }, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Unknown or removed action');
    expect(res.content[0]?.text).toContain('reserve');
  });

  it('rejects join as removed', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentJoin');

    const res = await callRouter('join', {}, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Unknown or removed action');
    expect(res.content[0]?.text).toContain('join');
  });

  it('rejects unknown legacy actions', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentLegacy');

    const actions = ['plan', 'work', 'review', 'crew.status'];

    for (const action of actions) {
      const res = await callRouter(action, {}, cwd, dirs, state);
      expect(res.content[0]?.text).toContain('Unknown or removed action');
    }
  });

  it('rejects spawn without objective text', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentSpawn');

    const res = await callRouter('spawn', { role: 'Researcher' }, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('spawn requires mission text');
  });

  it('lists no spawned agents initially', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createState('AgentSpawn');

    const res = await callRouter('spawn.list', {}, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('No spawned agents');
  });

  it('allows spawn.list without registration', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createUnregisteredState();

    const res = await callRouter('spawn.list', {}, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('No spawned agents');
  });

  it('allows swarm without registration', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createUnregisteredState();

    const res = await callRouter('swarm', {}, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Worker Pool');
  });

  it('rejects status without registration', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createUnregisteredState();

    const res = await callRouter('status', {}, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Not registered');
  });

  it('rejects list without registration', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createUnregisteredState();

    const res = await callRouter('list', {}, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Not registered');
  });

  it('rejects removed actions without registration as removed_action', async () => {
    const cwd = createTempCwd();
    const dirs = createDirs(cwd);
    const state = createUnregisteredState();

    const res = await callRouter('task.create', { title: 'test' }, cwd, dirs, state);
    expect(res.content[0]?.text).toContain('Unknown or removed action');
  });
});
