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

import { spawnSubagent, clearSpawnStateForTests } from '../../swarm/spawn.js';
import { ProjectSupervisor, SUPERVISOR_SESSION_ID } from '../../swarm/supervisor.js';

const roots = new Set<string>();

function createTempCwd(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-coordinator-'));
  roots.add(cwd);
  return cwd;
}

afterEach(() => {
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
  roots.clear();
  clearSpawnStateForTests();
});

beforeEach(() => {
  spawnMock.mockReset();
  execSyncMock.mockReset();
  execSyncMock.mockImplementation((cmd: string) => {
    if (cmd.includes('br ready')) return '[]';
    if (cmd.includes('br list')) return '[]';
    return '[]';
  });
});

function makeConfig(overrides: Partial<SupervisorConfig> = {}): MessengerConfig {
  return {
    autoRegister: false, autoRegisterPaths: [], scopeToFolder: true,
    contextMode: 'full', registrationContext: false, replyHint: false,
    senderDetailsOnFirstContact: false, nameTheme: 'default', feedRetention: 50,
    stuckThreshold: 900, stuckNotify: false, autoStatus: false, autoOverlay: false,
    swarmEventsInFeed: false, maxConcurrentSpawns: 5,
    supervisor: {
      enabled: true, paused: false, pollIntervalMs: 100, maxStartsPerTick: 2,
      workerPools: [{ id: 'default', workers: 3, model: { mode: 'inherit' }, enabled: true }],
      coordinator: { enabled: false, model: { mode: 'inherit' }, mode: 'manual' },
      goalRefiner: { enabled: false, model: { mode: 'inherit' }, mode: 'manual' },
      ...overrides,
    },
  };
}

function setupProject(cwd: string, config: MessengerConfig): void {
  fs.mkdirSync(path.join(cwd, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.pi', 'pi-messenger.json'), JSON.stringify(config));
  fs.mkdirSync(path.join(cwd, 'agents'), { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, '..', '..', 'agents', 'coordinator.md'),
    path.join(cwd, 'agents', 'coordinator.md'),
  );
}

describe('coordinator interval trigger', () => {
  it('does not spawn coordinator when disabled', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({ coordinator: { enabled: false, model: { mode: 'inherit' }, mode: 'manual' } });
    setupProject(cwd, config);

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');

    const coordinatorSpawns = spawnMock.mock.calls.filter((c: unknown[]) => {
      const args = (c[1] as string[]).filter((a) => typeof a === 'string');
      return args.some((a) => a.includes('Coordinator'));
    });
    expect(coordinatorSpawns).toHaveLength(0);
  });

  it('spawns coordinator when failed worker exists and interval mode enabled', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({
      coordinator: { enabled: true, model: { mode: 'inherit' }, mode: 'interval', intervalMinutes: 0 },
    });
    setupProject(cwd, config);

    // Spawn a worker that will fail
    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);
    spawnSubagent(cwd, { role: 'Worker', objective: 'Test' }, SUPERVISOR_SESSION_ID);
    proc.emit('close', 1);

    spawnMock.mockReset();
    spawnMock.mockReturnValue(new FakeProcess() as unknown);

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');

    expect(spawnMock.mock.calls.length).toBeGreaterThan(0);
    const lastArgs = (spawnMock.mock.calls[spawnMock.mock.calls.length - 1][1]) as string[];
    const promptIdx = lastArgs.indexOf('--append-system-prompt');
    if (promptIdx !== -1) {
      expect(fs.readFileSync(lastArgs[promptIdx + 1], 'utf-8')).toContain('Coordinator');
    }
  });

  it('spawns coordinator when no ready beads but in-progress work exists', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({
      coordinator: { enabled: true, model: { mode: 'inherit' }, mode: 'interval', intervalMinutes: 0 },
    });
    setupProject(cwd, config);

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('br ready')) return '[]';
      if (cmd.includes('br list')) return '[{"id":"br-1","title":"test","status":"in_progress"}]';
      return '[]';
    });

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);
    spawnSubagent(cwd, { role: 'Worker', objective: 'Test' }, SUPERVISOR_SESSION_ID);

    spawnMock.mockReset();
    spawnMock.mockReturnValue(new FakeProcess() as unknown);

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');

    expect(spawnMock.mock.calls.length).toBeGreaterThan(0);
  });

  it('prevents overlap: does not spawn coordinator while one is running', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({
      coordinator: { enabled: true, model: { mode: 'inherit' }, mode: 'interval', intervalMinutes: 0 },
    });
    setupProject(cwd, config);

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('br ready')) return '[]';
      if (cmd.includes('br list')) return '[{"id":"br-1","status":"in_progress"}]';
      return '[]';
    });

    // Spawn a running worker
    const workerProc = new FakeProcess();
    spawnMock.mockReturnValue(workerProc as unknown);
    spawnSubagent(cwd, { role: 'Worker', objective: 'Test' }, SUPERVISOR_SESSION_ID);

    // Track spawn calls — coordinator spawns after first tick
    spawnMock.mockClear();
    const coordProc = new FakeProcess();
    spawnMock.mockReturnValue(coordProc as unknown);

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');

    const firstCallCount = spawnMock.mock.calls.length;
    expect(firstCallCount).toBeGreaterThanOrEqual(1);

    // Second tick — coordinator should still be running, no new spawn
    await sup.requestTick('test');
    expect(spawnMock.mock.calls.length).toBe(firstCallCount);
  });

  it('does not trigger coordinator on healthy idle project', async () => {
    const cwd = createTempCwd();
    const config = makeConfig({
      coordinator: { enabled: true, model: { mode: 'inherit' }, mode: 'interval', intervalMinutes: 0 },
    });
    setupProject(cwd, config);

    // No ready, no in-progress, no running workers, no failed workers
    execSyncMock.mockImplementation(() => '[]');

    const sup = new ProjectSupervisor(cwd);
    await sup.requestTick('test');

    const coordinatorSpawns = spawnMock.mock.calls.filter((c: unknown[]) => {
      const args = (c[1] as string[]).filter((a) => typeof a === 'string');
      return args.some((a) => a.includes('Coordinator'));
    });
    expect(coordinatorSpawns).toHaveLength(0);
  });
});
