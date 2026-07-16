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
const ESC = String.fromCharCode(27);

// Strip truecolor ANSI (the bee) so visible-width assertions are meaningful.
const strip = (s: string): string =>
  s
    .split(ESC)
    .map((part, i) => (i === 0 ? part : part.replace(/^[^m]*m/, '')))
    .join('');

beforeAll(() => {
  savedCwd = process.cwd();
  savedPort = process.env.PI_MESSENGER_PORT;
  process.env.PI_MESSENGER_PORT = '1';
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-viewport-'));
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
    } catch {}
  }
});

function newOverlay(): SwarmOverlay {
  return new SwarmOverlay({} as unknown, theme as unknown, done, {} as unknown);
}

const WIDTHS = [40, 72, 90, 120];

describe('swarm overlay viewport (§22.13)', () => {
  for (const width of WIDTHS) {
    it(`renders Overview invariants and never exceeds ${width} columns`, () => {
      const o = newOverlay();
      const visible = strip(o.render(width).join('\n'));
      expect(visible).toContain('Swarm Control Plane');
      expect(visible).toContain('Overview');
      expect(visible).toContain('Supervisor: ○OFF');
      expect(visible).toContain('Workers 0/6');
      expect(visible).toContain('## Status');
      expect(visible).toContain('Why:');
      expect(visible).toContain('## Summary');
      expect(visible).toContain('NO WORKERS');
      expect(visible).toContain('█');
      if (width < 72) expect(visible).not.toContain('pi-ultra-messenger ·');
      else expect(visible).toContain('pi-ultra-messenger ·');
      const w = Math.max(40, Math.min(width, 140));
      for (const line of visible.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(w);
      }
    });
  }

  it('Activity panel shows the empty state', () => {
    const o = newOverlay();
    o.handleInput('4');
    expect(strip(o.render(90).join('\n'))).toContain('No worker history.');
  });

  it('help overlay lists keybinds and toggles off', () => {
    const o = newOverlay();
    o.handleInput('?');
    const visible = strip(o.render(90).join('\n'));
    expect(visible).toContain('## Help');
    expect(visible).toContain('Enter');
    expect(visible).toContain('search workers');
    o.handleInput('?');
    expect(strip(o.render(90).join('\n'))).not.toContain('## Help');
  });

  it('Esc closes help without closing the overlay', () => {
    const o = newOverlay();
    o.handleInput('?');
    o.handleInput(ESC);
    expect(done).not.toHaveBeenCalled();
    expect(strip(o.render(90).join('\n'))).not.toContain('## Help');
  });
});
