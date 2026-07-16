import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';

const roots = new Set<string>();

function createTempProject(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-supervisor-cli-'));
  roots.add(cwd);
  return cwd;
}

afterEach(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  roots.clear();
});

const CLI = path.resolve(__dirname, '..', '..', 'dist', 'harness', 'cli.js');

function run(cwd: string, args: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI} ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 20_000,
      env: { ...process.env, PI_MESSENGER_PORT: '0' },
    });
    return { stdout, stderr: '', code: 0 };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      code: err.status ?? 1,
    };
  }
}

describe('supervisor CLI lifecycle commands', () => {
  it('supervisor start is routed to the server, not silently swallowed as a local command', () => {
    const cwd = createTempProject();
    fs.mkdirSync(path.join(cwd, '.pi'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.pi', 'pi-messenger.json'),
      JSON.stringify({ supervisor: { enabled: false, paused: false, workerPools: [] } })
    );

    const result = run(cwd, 'supervisor start');
    // The old bug: supervisor was caught by the local-command guard and
    // returned code 0 with empty output. The fix routes it to the
    // server-backed handler, which (with no server reachable on port 0)
    // must produce a non-silent result — either an error message or a
    // non-zero exit.
    const silent = result.code === 0 && result.stdout === '' && result.stderr === '';
    expect(silent).toBe(false);
    // Supervisor must not be mistaken for a pool subcommand.
    expect(result.stdout).not.toContain('No pools configured');
  });

  it('supervisor status is dispatched to the server, not treated as a pool list', () => {
    const cwd = createTempProject();
    const result = run(cwd, 'supervisor status');
    expect(result.stdout).not.toContain('No pools configured');
    expect(result.stdout).not.toMatch(/pool-\d+: \d+ workers/);
  });
});
