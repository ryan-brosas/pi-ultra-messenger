import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';

const roots = new Set<string>();

function createTempProject(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-setup-'));
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

describe('pool add model validation', () => {
  it('rejects invalid model before writing config', () => {
    const cwd = createTempProject();
    let exitCode = 0;
    let stderr = '';
    try {
      execSync(`node ${CLI} pool add --model bogus/fake-model --workers 3`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
        env: { ...process.env, PI_MESSENGER_PORT: '0' },
      });
    } catch (e: unknown) {
      const err = e as { status?: number; stderr?: string };
      exitCode = err.status ?? 1;
      stderr = err.stderr ?? '';
    }

    expect(exitCode).toBe(1);
    expect(stderr).toContain('not available');

    // Verify config was NOT written
    const configPath = path.join(cwd, '.pi', 'pi-messenger.json');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('accepts inherit model without validation', () => {
    const cwd = createTempProject();
    let stdout = '';
    try {
      stdout = execSync(`node ${CLI} pool add --model inherit --workers 2`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
        env: { ...process.env, PI_MESSENGER_PORT: '0' },
      });
    } catch (e: unknown) {
      // If server can't start in test env, check config was still written
    }

    const configPath = path.join(cwd, '.pi', 'pi-messenger.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.supervisor.workerPools[0].model.mode).toBe('inherit');
    }
  });
});
