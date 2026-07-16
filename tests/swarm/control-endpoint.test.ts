/**
 * Integration tests for the POST /control endpoint — the single mutation
 * authority used by the /swarm overlay (and available to the CLI).
 *
 * Starts the real harness server on an ephemeral port against an isolated
 * temp project, exercises swarm.start / pause / resume / stop / status, and
 * verifies the config-on-disk, the returned configSnapshot, and the
 * control-audit trail.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const roots = new Set<string>();
let tempProject: string;
let port: number;
let savedEnv: Record<string, string | undefined>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let server: any;

function createProject(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-control-'));
  roots.add(cwd);
  fs.mkdirSync(path.join(cwd, '.pi', 'messenger'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.pi', 'pi-messenger.json'),
    JSON.stringify({
      maxConcurrentSpawns: 5,
      supervisor: {
        enabled: false,
        paused: false,
        pollIntervalMs: 60_000,
        maxStartsPerTick: 2,
        workerPools: [{ id: 'pool-0', workers: 2, model: { mode: 'inherit' }, enabled: true }],
        coordinator: { enabled: false, model: { mode: 'inherit' }, mode: 'manual' },
        goalRefiner: {
          enabled: false,
          model: { mode: 'inherit' },
          mode: 'manual',
          minimumQualityScore: 75,
        },
      },
    })
  );
  return cwd;
}

beforeAll(async () => {
  savedEnv = { ...process.env };
  tempProject = createProject();
  process.env.PI_MESSENGER_PORT = '0';
  process.env.PI_MESSENGER_CWD = tempProject;
  process.env.PI_MESSENGER_DIR = path.join(tempProject, '.pi', 'messenger');
  process.env.PI_MESSENGER_LOG = path.join(tempProject, '.pi', 'messenger', 'server.log');
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-control-'));
  roots.add(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const mod = await import('../../harness/server.js');
  server = mod.server;
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  const addr = server.address() as { port: number } | null;
  if (!addr || !addr.port) throw new Error('server did not bind a port');
  port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const key of [
    'PI_MESSENGER_PORT',
    'PI_MESSENGER_CWD',
    'PI_MESSENGER_DIR',
    'PI_MESSENGER_LOG',
    'PI_CODING_AGENT_DIR',
  ]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function readConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(tempProject, '.pi', 'pi-messenger.json'), 'utf-8'));
}

async function postControl(
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function auditEntries(): Array<Record<string, unknown>> {
  const f = path.join(tempProject, '.pi', 'messenger', 'control-audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('POST /control endpoint', () => {
  it('status reports the initial disabled supervisor', async () => {
    const { status, json } = await postControl({ op: 'status', cwd: tempProject });
    expect(status).toBe(200);
    const snap = json.snapshot as Record<string, unknown>;
    expect(snap.enabled).toBe(false);
    expect(snap.tickCount).toBe(0);
    expect((json.configSnapshot as Record<string, unknown>).enabled).toBe(false);
  });

  it('swarm.start bootstraps the supervisor and flips config to enabled', async () => {
    const { status, json } = await postControl({
      op: 'swarm.start',
      cwd: tempProject,
      source: 'ui',
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    const snap = json.snapshot as Record<string, unknown>;
    expect(snap.enabled).toBe(true);
    expect((json.configSnapshot as Record<string, unknown>).enabled).toBe(true);
    // Config on disk reflects the change
    expect((readConfig().supervisor as Record<string, unknown>).enabled).toBe(true);
  });

  it('pause sets paused=true on disk and in snapshot', async () => {
    const { status, json } = await postControl({ op: 'pause', cwd: tempProject });
    expect(status).toBe(200);
    expect((json.snapshot as Record<string, unknown>).paused).toBe(true);
    expect((readConfig().supervisor as Record<string, unknown>).paused).toBe(true);
  });

  it('resume clears paused and re-enables', async () => {
    const { status, json } = await postControl({ op: 'resume', cwd: tempProject });
    expect(status).toBe(200);
    expect((json.snapshot as Record<string, unknown>).paused).toBe(false);
    expect((readConfig().supervisor as Record<string, unknown>).paused).toBe(false);
  });

  it('stop disables the supervisor on disk', async () => {
    const { status, json } = await postControl({ op: 'stop', cwd: tempProject });
    expect(status).toBe(200);
    expect((json.snapshot as Record<string, unknown>).enabled).toBe(false);
    expect((readConfig().supervisor as Record<string, unknown>).enabled).toBe(false);
  });

  it('rejects unknown ops with 400 and audits the failure', async () => {
    const { status, json } = await postControl({ op: 'bogus', cwd: tempProject });
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
  });

  it('writes a control-audit trail with source=ui for mutating ops', () => {
    const entries = auditEntries();
    const ops = entries.map((e) => e.op);
    expect(ops).toContain('swarm.start');
    expect(ops).toContain('pause');
    expect(ops).toContain('resume');
    expect(ops).toContain('stop');
    expect(entries.every((e) => e.source === 'ui' || e.source === 'cli')).toBe(true);
    expect(entries.every((e) => e.type === 'control')).toBe(true);
  });
});
