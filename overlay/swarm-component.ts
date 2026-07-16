/**
 * Swarm Overlay — /swarm TUI for the pi-ultra-messenger worker pool.
 *
 * Five panels: Overview, Workers, Pools, Activity, Diagnostics.
 * Switch with Tab/1-5. Responsive at 40/60/90/140 columns.
 * Empty and degraded states are explicit.
 */

import type { Component, Focusable, TUI } from '@earendil-works/pi-tui';
import { truncateToWidth } from '@earendil-works/pi-tui';
import type { Theme } from '@earendil-works/pi-coding-agent';
import type { MessengerConfig, WorkerPoolConfig } from '../config.js';
import { loadConfig } from '../config.js';
import { listSpawned } from '../swarm/spawn.js';
import { getLiveWorkers } from '../swarm/live-progress.js';
import type { SpawnedAgent } from '../swarm/types.js';
import * as fs from 'node:fs';
import { join } from 'node:path';

type PanelName = 'overview' | 'workers' | 'pools' | 'activity' | 'diagnostics';

const PANELS: PanelName[] = ['overview', 'workers', 'pools', 'activity', 'diagnostics'];
const PANEL_LABELS: Record<PanelName, string> = {
  overview: 'Overview',
  workers: 'Workers',
  pools: 'Pools',
  activity: 'Activity',
  diagnostics: 'Diagnostics',
};

const SUPERVISOR_SESSION = 'pi-swarm-supervisor';

export interface SwarmOverlayCallbacks {
  onBackground?: (snapshot: string) => void;
}

export class SwarmOverlay implements Component, Focusable {
  get width(): number {
    return Math.min(140, Math.max(40, process.stdout.columns ?? 90));
  }
  get height(): number {
    return Math.max(20, (process.stdout.rows ?? 24) - 2);
  }
  focused = false;

  private currentPanel: PanelName = 'overview';
  private selectedWorkerIndex = 0;
  private cwd: string;
  // Control-plane state
  private viewOnly = false;
  private pendingConfirm: string | null = null;
  private pendingTwoKey: string | null = null;
  private lastControlMsg = '';
  private tickCount = 0;
  private harnessUp = true;
  private lastTickFetchAt = 0;

  constructor(
    _tui: TUI,
    private theme: Theme,
    private done: (snapshot?: string) => void,
    private callbacks: SwarmOverlayCallbacks
  ) {
    this.cwd = process.cwd();
  }

  // --- Control plane (HTTP to the harness, the single mutation authority) ---

  private controlUrl(path: string): string {
    const port = Number(process.env.PI_MESSENGER_PORT ?? 9877);
    return `http://127.0.0.1:${port}${path}`;
  }

  private async postControl(op: string): Promise<void> {
    try {
      const res = await fetch(this.controlUrl('/control'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, cwd: this.cwd, source: 'ui' }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      this.harnessUp = true;
      this.lastControlMsg = json.ok ? `${op} ok` : `error: ${json.error ?? res.status}`;
    } catch {
      this.harnessUp = false;
      this.lastControlMsg = 'harness unreachable — run pi-ultra-messenger --start';
    }
  }

  private async pollTick(): Promise<void> {
    const now = Date.now();
    if (now - this.lastTickFetchAt < 1000) return;
    this.lastTickFetchAt = now;
    try {
      const res = await fetch(this.controlUrl('/control'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'status', cwd: this.cwd, source: 'ui' }),
      });
      const json = (await res.json()) as {
        snapshot?: { tickCount?: number };
      };
      if (json.snapshot?.tickCount !== undefined) this.tickCount = json.snapshot.tickCount;
      this.harnessUp = true;
    } catch {
      this.harnessUp = false;
    }
  }

  /** 12-cell block bar, rounded to whole cells. */
  private bar(filled: number, total: number, width = 12): string {
    const ratio = total <= 0 ? 0 : Math.min(1, Math.max(0, filled / total));
    const cells = Math.round(ratio * width);
    return '█'.repeat(cells) + '░'.repeat(width - cells);
  }

  // --- Component interface ---
  render(width: number): string[] {
    void this.pollTick();
    const config = loadConfig(this.cwd);
    const workers = listSpawned(this.cwd, SUPERVISOR_SESSION, true);
    const running = workers.filter((w) => w.status === 'running');
    const liveWorkers = getLiveWorkers();

    const lines: string[] = [];
    const w = Math.max(40, Math.min(width, 140));

    lines.push(this.renderTitleBar(w));
    lines.push(this.renderTabBar(w));
    lines.push(this.theme.fg('dim', '─'.repeat(w)));

    const panelLines = this.renderPanel(
      this.currentPanel,
      w,
      config,
      workers,
      running,
      liveWorkers
    );
    lines.push(...panelLines);

    const footerY = this.height - 2;
    while (lines.length < footerY) lines.push('');
    lines.push(this.theme.fg('dim', '─'.repeat(w)));
    lines.push(this.renderFooter(w));

    return lines;
  }

  invalidate(): void {
    // No cache — data is read fresh on each render
  }

  // --- Focusable interface ---

  focus(): void {
    this.focused = true;
  }

  blur(): void {
    this.focused = false;
  }

  isFocused(): boolean {
    return this.focused;
  }

  handleInput(data: string): void {
    // Tab — cycle panels
    if (data === '\t') {
      const idx = PANELS.indexOf(this.currentPanel);
      this.currentPanel = PANELS[(idx + 1) % PANELS.length];
      this.selectedWorkerIndex = 0;
      return;
    }

    // Number keys 1-5 — jump to panel
    const numKey = parseInt(data, 10);
    if (numKey >= 1 && numKey <= 5) {
      this.currentPanel = PANELS[numKey - 1];
      this.selectedWorkerIndex = 0;
      return;
    }

    // j/k — navigate worker list
    if (data === 'j' || data === 'k') {
      const workers = listSpawned(this.cwd, SUPERVISOR_SESSION, true);
      if (data === 'j' && this.selectedWorkerIndex < workers.length - 1) this.selectedWorkerIndex++;
      if (data === 'k' && this.selectedWorkerIndex > 0) this.selectedWorkerIndex--;
      return;
    }

    // ro (two-key) aliases v for view-only toggle, per the control-plane plan.
    // 'r' arms the sequence; the next keystroke toggles only if it is 'o',
    // otherwise it is processed normally (so 'r' then 'k' still navigates).
    if (this.pendingTwoKey === 'ro') {
      this.pendingTwoKey = null;
      if (data === 'o') {
        this.viewOnly = !this.viewOnly;
        this.lastControlMsg = this.viewOnly ? 'view-only on' : 'view-only off';
        return;
      }
      // not 'o' — fall through and handle this keystroke normally
    }
    if (data === 'r') {
      this.pendingTwoKey = 'ro';
      return;
    }

    // v — toggle view-only mode (disables all mutating keys)
    if (data === 'v') {
      this.viewOnly = !this.viewOnly;
      this.lastControlMsg = this.viewOnly ? 'view-only on' : 'view-only off';
      return;
    }

    // Pending y/N confirmation for a destructive control op (e.g. stop)
    if (this.pendingConfirm) {
      if (data === 'y' || data === 'Y') {
        const op = this.pendingConfirm;
        this.pendingConfirm = null;
        this.lastControlMsg = `${op}…`;
        void this.postControl(op);
      } else {
        this.pendingConfirm = null;
        this.lastControlMsg = 'cancelled';
      }
      return;
    }

    // Supervisor control keys (global; the supervisor is not panel-scoped).
    // Mutating keys are disabled in view-only mode.
    if (!this.viewOnly) {
      if (data === 'S') {
        this.lastControlMsg = 'swarm.start…';
        void this.postControl('swarm.start');
        return;
      }
      if (data === 'p') {
        this.lastControlMsg = 'pause…';
        void this.postControl('pause');
        return;
      }
      if (data === 'P') {
        this.lastControlMsg = 'resume…';
        void this.postControl('resume');
        return;
      }
      if (data === 's') {
        this.pendingConfirm = 'stop';
        return;
      }
    }

    // q or Esc — close
    if (data === 'q' || data === '\x1b') {
      const snapshot = this.renderSnapshot();
      this.done(snapshot);
      return;
    }

    // b — background (send snapshot, don't close)
    if (data === 'b') {
      const snapshot = this.renderSnapshot();
      this.callbacks.onBackground?.(snapshot);
      return;
    }
  }

  // --- Rendering ---

  private renderTitleBar(w: number): string {
    const beat = this.harnessUp ? (this.tickCount % 2 === 0 ? '●' : '○') : '○';
    const title = 'pi-ultra-messenger Worker Pool';
    const right = `${beat}${this.viewOnly ? ' [view-only]' : ''}`;
    const pad = Math.max(1, w - title.length - right.length);
    return this.theme.fg('accent', title) + ' '.repeat(pad) + this.theme.fg('dim', right);
  }

  private renderTabBar(w: number): string {
    const parts = PANELS.map((p) => {
      const label = PANEL_LABELS[p];
      const idx = PANELS.indexOf(p) + 1;
      const marker = p === this.currentPanel ? '▸' : ' ';
      const text = `${marker}${idx}:${label}`;
      return p === this.currentPanel ? this.theme.fg('accent', text) : this.theme.fg('dim', text);
    });
    return truncateToWidth(parts.join('  '), w);
  }

  private renderPanel(
    panel: PanelName,
    w: number,
    config: MessengerConfig,
    workers: SpawnedAgent[],
    running: SpawnedAgent[],
    liveWorkers: ReturnType<typeof getLiveWorkers>
  ): string[] {
    switch (panel) {
      case 'overview':
        return this.renderOverview(w, config, running, workers);
      case 'workers':
        return this.renderWorkers(w, running, liveWorkers);
      case 'pools':
        return this.renderPools(w, config, running);
      case 'activity':
        return this.renderActivity(w, workers);
      case 'diagnostics':
        return this.renderDiagnostics(w, config);
    }
  }

  private renderOverview(
    w: number,
    config: MessengerConfig,
    running: SpawnedAgent[],
    workers: SpawnedAgent[]
  ): string[] {
    const lines: string[] = [];
    const completed = workers.filter((w) => w.status === 'completed').length;
    const failed = workers.filter((w) => w.status === 'failed').length;

    // Supervisor control bar
    const supGlyph = config.supervisor.enabled ? (config.supervisor.paused ? '◐' : '●') : '○';
    const supLabel = config.supervisor.enabled
      ? config.supervisor.paused
        ? 'PAUSE'
        : 'RUN'
      : 'OFF';
    const headroom = this.bar(running.length, config.maxConcurrentSpawns);
    const ctrlHints = this.viewOnly
      ? this.theme.fg('dim', '  [view-only] mutating keys disabled (v to toggle)')
      : this.theme.fg('dim', '  [S]tart [p]ause [P]resume [s]top · v:view-only');
    lines.push(
      '',
      `Supervisor: ${supGlyph}${supLabel}  Workers ${running.length}/${config.maxConcurrentSpawns} ${headroom}`
    );
    lines.push(ctrlHints);
    if (this.pendingConfirm)
      lines.push(this.theme.fg('accent', `  ${this.pendingConfirm} supervisor? [y/N]`));
    if (this.lastControlMsg) lines.push(this.theme.fg('dim', `  → ${this.lastControlMsg}`));

    lines.push('', '## Summary');
    lines.push(`  Running: ${running.length}`);
    lines.push(`  Completed: ${completed}`);
    lines.push(`  Failed: ${failed}`);
    lines.push(`  Max concurrent: ${config.maxConcurrentSpawns}`);

    const supStatus = config.supervisor.enabled
      ? config.supervisor.paused
        ? 'paused'
        : 'enabled'
      : 'disabled';
    lines.push(`  Supervisor: ${supStatus}`);

    if (config.supervisor.workerPools.length > 0) {
      lines.push('', '## Pools');
      for (const pool of config.supervisor.workerPools) {
        const model = pool.model.mode === 'inherit' ? 'inherit' : pool.model.model;
        const state = pool.enabled ? 'on' : 'off';
        lines.push(`  ${pool.id}: ${pool.workers}w · ${model} · ${state}`);
      }
    }

    if (running.length === 0 && workers.length === 0) {
      lines.push('', this.theme.fg('dim', '  No workers. Press S to start the swarm.'));
    }

    return lines;
  }

  private renderWorkers(
    w: number,
    running: SpawnedAgent[],
    liveWorkers: ReturnType<typeof getLiveWorkers>
  ): string[] {
    const lines: string[] = [];

    if (running.length === 0) {
      lines.push('', this.theme.fg('dim', '  No running workers.'));
      return lines;
    }

    lines.push('', '## Running Workers');
    for (let i = 0; i < running.length; i++) {
      const worker = running[i];
      const select = i === this.selectedWorkerIndex ? '▸ ' : '  ';
      const phase = worker.phase ? ` · ${worker.phase}` : '';
      const bead = worker.currentBeadId ? ` → ${worker.currentBeadId}` : '';
      const model = worker.model ? ` [${worker.model}]` : '';
      const msg = worker.statusMessage ? ` — ${worker.statusMessage}` : '';
      lines.push(
        truncateToWidth(`${select}${worker.name} (${worker.role})${model}${phase}${bead}${msg}`, w)
      );
    }

    // Live workers (in-progress, not yet in spawned list)
    const liveNames = new Set(running.map((w) => w.name));
    const extraLive = Array.from(liveWorkers.values()).filter((lw) => !liveNames.has(lw.name));
    if (extraLive.length > 0) {
      lines.push('', '## Starting');
      for (const lw of extraLive.slice(0, 5)) {
        const activity = lw.progress.currentTool ? lw.progress.currentTool : 'thinking';
        lines.push(truncateToWidth(`  ${lw.name} — ${activity}`, w));
      }
    }

    return lines;
  }

  private renderPools(w: number, config: MessengerConfig, running: SpawnedAgent[]): string[] {
    const lines: string[] = [];

    if (config.supervisor.workerPools.length === 0) {
      lines.push('', this.theme.fg('dim', '  No pools configured. Use setup to create one.'));
      return lines;
    }

    lines.push('', '## Worker Pools');
    for (const pool of config.supervisor.workerPools) {
      const model = pool.model.mode === 'inherit' ? 'inherit' : pool.model.model;
      const state = pool.enabled ? 'enabled' : 'disabled';
      const poolWorkers = running.filter(
        (w) => w.poolId === pool.id || (w.poolId === undefined && pool.id === 'default')
      );
      const deficit = Math.max(0, pool.workers - poolWorkers.length);
      const fill = this.bar(poolWorkers.length, pool.workers);
      lines.push(
        `  ${pool.id}: ${poolWorkers.length}/${pool.workers} ${fill} · ${model} · ${state}`
      );
      if (deficit > 0) {
        lines.push(this.theme.fg('dim', `    deficit: ${deficit}`));
      }
    }

    return lines;
  }

  private renderActivity(w: number, workers: SpawnedAgent[]): string[] {
    const lines: string[] = [];

    if (workers.length === 0) {
      lines.push('', this.theme.fg('dim', '  No worker history.'));
      return lines;
    }

    lines.push('', '## Recent Activity');
    for (const worker of workers.slice(0, 15)) {
      const status =
        worker.status === 'completed'
          ? '✅'
          : worker.status === 'failed'
            ? '❌'
            : worker.status === 'stopped'
              ? '⏹'
              : '🔄';
      const ended = worker.endedAt ? ` · ${new Date(worker.endedAt).toLocaleTimeString()}` : '';
      const msg = worker.statusMessage ? ` — ${worker.statusMessage}` : '';
      lines.push(truncateToWidth(`  ${status} ${worker.name} (${worker.role})${ended}${msg}`, w));
    }

    return lines;
  }

  private renderDiagnostics(w: number, config: MessengerConfig): string[] {
    const lines: string[] = [];

    lines.push('', '## System');
    lines.push(`  Project: ${this.cwd}`);
    lines.push(
      `  AGENTS.md: ${fs.existsSync(join(this.cwd, 'AGENTS.md')) ? 'found' : 'not found'}`
    );
    lines.push(`  Supervisor session: ${SUPERVISOR_SESSION}`);
    lines.push(`  Poll interval: ${config.supervisor.pollIntervalMs}ms`);
    lines.push(`  Max starts per tick: ${config.supervisor.maxStartsPerTick}`);
    lines.push(`  Coordinator: ${config.supervisor.coordinator.enabled ? 'enabled' : 'disabled'}`);
    lines.push(`  Goal refiner: ${config.supervisor.goalRefiner.enabled ? 'enabled' : 'disabled'}`);

    return lines;
  }

  private renderFooter(w: number): string {
    const hints = this.viewOnly
      ? 'v:view-only · Tab/1-5: panels · j/k: navigate · q: quit'
      : 'S:start p:pause P:resume s:stop · v:view-only · Tab/1-5 · j/k · b:bg · q:quit';
    return truncateToWidth(this.theme.fg('dim', hints), w);
  }

  private renderSnapshot(): string {
    const config = loadConfig(this.cwd);
    const workers = listSpawned(this.cwd, SUPERVISOR_SESSION, true);
    const running = workers.filter((w) => w.status === 'running');
    const completed = workers.filter((w) => w.status === 'completed');
    const failed = workers.filter((w) => w.status === 'failed');

    const lines: string[] = ['# Worker Pool', ''];
    lines.push(
      `Running: ${running.length}  Completed: ${completed.length}  Failed: ${failed.length}`
    );
    lines.push(`Supervisor: ${config.supervisor.enabled ? 'enabled' : 'disabled'}`);
    if (running.length > 0) {
      lines.push('', '## Running');
      for (const w of running.slice(0, 10)) {
        lines.push(
          `  ${w.name} (${w.role})${w.phase ? ` · ${w.phase}` : ''}${w.currentBeadId ? ` → ${w.currentBeadId}` : ''}`
        );
      }
    }
    if (config.supervisor.workerPools.length > 0) {
      lines.push('', '## Pools');
      for (const pool of config.supervisor.workerPools) {
        const model = pool.model.mode === 'inherit' ? 'inherit' : pool.model.model;
        lines.push(
          `  ${pool.id}: ${pool.workers} workers · ${model} · ${pool.enabled ? 'on' : 'off'}`
        );
      }
    }
    return lines.join('\n');
  }
}
