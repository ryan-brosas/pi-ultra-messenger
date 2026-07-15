import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SUPERVISOR_SESSION_ID } from '../../swarm/supervisor.js';
import { updateSpawnStatus } from '../../swarm/spawn.js';

const roots = new Set<string>();

function createTempCwd(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-worker-status-'));
  roots.add(cwd);
  return cwd;
}

afterEach(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  roots.clear();
});

describe('worker status telemetry', () => {
  it('updateSpawnStatus returns null for unknown id', () => {
    const cwd = createTempCwd();
    const result = updateSpawnStatus(cwd, 'nonexistent', { phase: 'implementing' });
    expect(result).toBeNull();
  });

  it('SUPERVISOR_SESSION_ID is stable', () => {
    expect(SUPERVISOR_SESSION_ID).toBe('pi-swarm-supervisor');
    expect(typeof SUPERVISOR_SESSION_ID).toBe('string');
  });

  it('PI_SWARM_SPAWN_ID env var is set in spawn source', () => {
    // Verify the env var is present in the spawn module source
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'swarm', 'spawn.ts'),
      'utf-8',
    );
    expect(source).toContain('PI_SWARM_SPAWN_ID');
  });
});
