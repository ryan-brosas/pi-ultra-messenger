import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { spawnSubagent, clearSpawnStateForTests } from '../../swarm/spawn.js';

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  kill = vi.fn();
  pid = 20000 + Math.floor(Math.random() * 9999);
}

const roots = new Set<string>();

function createTempCwd(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-role-prompts-'));
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
});

function getSystemPromptFromLastSpawn(): string {
  const callArgs = spawnMock.mock.calls[0];
  const args = callArgs[1] as string[];
  const promptFileIdx = args.indexOf('--append-system-prompt');
  if (promptFileIdx === -1) return '';
  return fs.readFileSync(args[promptFileIdx + 1], 'utf-8');
}

describe('role prompt tests', () => {
  it('coordinator role file contains required contract elements', () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'agents', 'coordinator.md'),
      'utf-8',
    );
    expect(content).toContain('coordinator');
    expect(content).toContain('Agent Mail');
    expect(content).toContain('disabled by default');
    expect(content).toContain('never gate');
    expect(content).toContain('exit');
    // Must NOT claim/edit beads
    expect(content).toContain('Do NOT claim');
    expect(content).toContain('Do NOT spawn');
  });

  it('refiner role file contains required contract elements', () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'agents', 'goal-refiner.md'),
      'utf-8',
    );
    expect(content).toContain('suggestion');
    expect(content).toContain('disabled by default');
    expect(content).toContain('never gate');
    expect(content).toContain('br comments add');
    expect(content).toContain('Do NOT modify');
    expect(content).toContain('exit');
  });

  it('coordinator spawn uses coordinator role file and prompt', () => {
    const cwd = createTempCwd();
    // Create the agents dir with the role file
    fs.mkdirSync(path.join(cwd, 'agents'), { recursive: true });
    fs.copyFileSync(
      path.resolve(__dirname, '..', '..', 'agents', 'coordinator.md'),
      path.join(cwd, 'agents', 'coordinator.md'),
    );

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    spawnSubagent(
      cwd,
      {
        role: 'Coordinator',
        agentFile: 'agents/coordinator.md',
        objective: 'Inspect worker pool state and send coordination messages via Agent Mail. Then exit.',
      },
      'test-session',
    );

    const callArgs = spawnMock.mock.calls[0];
    const args = callArgs[1] as string[];
    const agentFileIdx = args.indexOf('--append-system-prompt');
    expect(agentFileIdx).toBeGreaterThan(-1);

    const systemPrompt = getSystemPromptFromLastSpawn();
    // The agent file content should be in the system prompt
    expect(systemPrompt).toContain('Coordinator Role');
    expect(systemPrompt).toContain('Agent Mail');
    expect(systemPrompt).toContain('Do NOT claim');
    // Should also contain the worker operating protocol
    expect(systemPrompt).toContain('Worker Operating Protocol');
  });

  it('refiner spawn uses refiner role file and prompt', () => {
    const cwd = createTempCwd();
    fs.mkdirSync(path.join(cwd, 'agents'), { recursive: true });
    fs.copyFileSync(
      path.resolve(__dirname, '..', '..', 'agents', 'goal-refiner.md'),
      path.join(cwd, 'agents', 'goal-refiner.md'),
    );

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    spawnSubagent(
      cwd,
      {
        role: 'Goal Refiner',
        agentFile: 'agents/goal-refiner.md',
        objective: 'Inspect ready work and post suggestion comments via br. Then exit.',
      },
      'test-session',
    );

    const systemPrompt = getSystemPromptFromLastSpawn();
    expect(systemPrompt).toContain('Goal Refiner Role');
    expect(systemPrompt).toContain('suggestion');
    expect(systemPrompt).toContain('br comments add');
    expect(systemPrompt).toContain('Worker Operating Protocol');
  });

  it('coordinator prompt does not contain removed Pi Messenger commands', () => {
    const cwd = createTempCwd();
    fs.mkdirSync(path.join(cwd, 'agents'), { recursive: true });
    fs.copyFileSync(
      path.resolve(__dirname, '..', '..', 'agents', 'coordinator.md'),
      path.join(cwd, 'agents', 'coordinator.md'),
    );

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    spawnSubagent(
      cwd,
      { role: 'Coordinator', agentFile: 'agents/coordinator.md', objective: 'Test' },
      'test-session',
    );

    const systemPrompt = getSystemPromptFromLastSpawn();
    expect(systemPrompt).not.toContain('task create');
    expect(systemPrompt).not.toContain('task claim');
    expect(systemPrompt).not.toContain('task done');
    expect(systemPrompt).not.toContain('pi-messenger-swarm feed');
    expect(systemPrompt).not.toContain('pi-messenger-swarm send');
  });

  it('refiner prompt does not contain removed Pi Messenger commands', () => {
    const cwd = createTempCwd();
    fs.mkdirSync(path.join(cwd, 'agents'), { recursive: true });
    fs.copyFileSync(
      path.resolve(__dirname, '..', '..', 'agents', 'goal-refiner.md'),
      path.join(cwd, 'agents', 'goal-refiner.md'),
    );

    const proc = new FakeProcess();
    spawnMock.mockReturnValue(proc as unknown);

    spawnSubagent(
      cwd,
      { role: 'Goal Refiner', agentFile: 'agents/goal-refiner.md', objective: 'Test' },
      'test-session',
    );

    const systemPrompt = getSystemPromptFromLastSpawn();
    expect(systemPrompt).not.toContain('task create');
    expect(systemPrompt).not.toContain('task claim');
    expect(systemPrompt).not.toContain('task done');
    expect(systemPrompt).not.toContain('pi-messenger-swarm feed');
    expect(systemPrompt).not.toContain('pi-messenger-swarm send');
  });
});
