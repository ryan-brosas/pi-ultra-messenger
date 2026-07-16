/**
 * Tests for the /swarm overlay control layer (Phase C1):
 * view-only toggle, supervisor control keys (S/p/P/s + y/N confirm),
 * control-bar + gauge rendering, and that view-only disables mutating keys.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SwarmOverlay } from '../../overlay/swarm-component.js';

const roots = new Set<string>();
let savedCwd: string;
let savedPort: string | undefined;

const theme = { fg: (_color: string, text: string) => text } as unknown;
const done = vi.fn();

function render(overlay: SwarmOverlay, width = 90): string {
  return overlay.render(width).join('\n');
}

beforeAll(() => {
  savedCwd = process.cwd();
  savedPort = process.env.PI_MESSENGER_PORT;
  // Closed port → control fetches fail deterministically (ECONNREFUSED).
  process.env.PI_MESSENGER_PORT = '1';
  // Never-resolving fetch so async postControl/pollTick never overwrite the
  // synchronous lastControlMsg set by handleInput — keeps tests deterministic.
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-overlay-control-'));
  roots.add(cwd);
  fs.mkdirSync(path.join(cwd, '.pi', 'messenger'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.pi', 'pi-messenger.json'),
    JSON.stringify({
      maxConcurrentSpawns: 6,
      supervisor: {
        enabled: false,
        paused: false,
        pollIntervalMs: 60_000,
        maxStartsPerTick: 2,
        workerPools: [{ id: 'pool-0', workers: 4, model: { mode: 'inherit' }, enabled: true }],
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
  process.chdir(cwd);
});

afterAll(() => {
  vi.unstubAllGlobals();
  process.chdir(savedCwd);
  if (savedPort === undefined) delete process.env.PI_MESSENGER_PORT;
  else process.env.PI_MESSENGER_PORT = savedPort;
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function newOverlay(): SwarmOverlay {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new SwarmOverlay({} as unknown, theme as unknown, done, {} as unknown);
}

describe('swarm overlay control layer', () => {
  it('renders the supervisor control bar and headroom gauge', () => {
    const o = newOverlay();
    const out = render(o);
    expect(out).toContain('Supervisor: ○OFF');
    expect(out).toContain('Workers 0/6');
    expect(out).toContain('[S]tart [p]ause [P]resume [s]top');
  });

  it('toggles view-only with v and disables mutating keys', () => {
    const o = newOverlay();
    o.handleInput('v'); // view-only on (also sets lastControlMsg to view-only)
    expect(render(o)).toContain('[view-only]');
    // S must be a no-op in view-only mode — it must not set a swarm.start message
    o.handleInput('S');
    const after = render(o);
    expect(after).not.toContain('→ swarm.start');
    expect(after).toContain('[view-only]');
    // toggle back off
    o.handleInput('v');
    expect(render(o)).not.toContain('[view-only]');
  });

  it('start key fires swarm.start', () => {
    const o = newOverlay();
    o.handleInput('S');
    expect(render(o)).toContain('→ swarm.start…');
  });

  it('pause and resume keys fire their ops', () => {
    const o = newOverlay();
    o.handleInput('p');
    expect(render(o)).toContain('→ pause…');
    o.handleInput('P');
    expect(render(o)).toContain('→ resume…');
  });

  it('stop requires y/N confirmation and cancels on anything else', () => {
    const o = newOverlay();
    o.handleInput('s');
    expect(render(o)).toContain('stop supervisor? [y/N]');
    o.handleInput('n'); // not y → cancel
    expect(render(o)).toContain('→ cancelled');
    expect(render(o)).not.toContain('→ stop…');
  });

  it('stop confirms on y and fires the op', () => {
    const o = newOverlay();
    o.handleInput('s');
    o.handleInput('y');
    expect(render(o)).toContain('→ stop…');
  });

  it('renders pool fill gauges with block characters', () => {
    const o = newOverlay();
    o.handleInput('3'); // Pools panel
    const out = render(o);
    expect(out).toContain('pool-0: 0/4');
    // 0/4 → all empty cells
    expect(out).toContain('░'.repeat(12));
  });
});
