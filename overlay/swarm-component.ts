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
import type { ProjectSupervisorSnapshot } from '../swarm/supervisor.js';
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
  // §22.9 input modes (Enter detail / / search / ? help)
  private detailMode = false;
  private searchMode = false;
  private searchQuery = '';
  private helpMode = false;
  private cwd: string;
  // Control-plane state
  private viewOnly = false;
  private pendingConfirm: string | null = null;
  private pendingTwoKey: string | null = null;
  private lastControlMsg = '';
  private tickCount = 0;
  private harnessUp = true;
  private lastTickFetchAt = 0;

  private animTimer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: ProjectSupervisorSnapshot | null = null;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private done: (snapshot?: string) => void,
    private callbacks: SwarmOverlayCallbacks
  ) {
    this.cwd = process.cwd();
  }

  /** Drive the animated mascot while the overlay is focused. */
  private startAnimation(): void {
    if (this.animTimer) return;
    this.animTimer = setInterval(() => this.tui.requestRender(), 100);
  }

  private stopAnimation(): void {
    if (!this.animTimer) return;
    clearInterval(this.animTimer);
    this.animTimer = null;
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
        snapshot?: ProjectSupervisorSnapshot;
      };
      if (json.snapshot) {
        this.lastSnapshot = json.snapshot;
        if (json.snapshot.tickCount !== undefined) this.tickCount = json.snapshot.tickCount;
      }
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

  /** Animated bee mascot — truecolor block pixels, two wing frames. */
  private renderBee(width: number, frame: 0 | 1): string[] {
    const ESC = String.fromCharCode(27);
    const RST = ESC + '[0m';
    const color = (r: number, g: number, b: number) => ESC + '[38;2;' + r + ';' + g + ';' + b + 'm';
    const Y = color(255, 196, 0);
    const K = color(44, 44, 52);
    const W = color(120, 220, 255);
    const E = color(255, 255, 255);
    const pal: Record<string, string> = { Y, K, W, E };
    const wingsUp = [
      '....WW......WW....',
      '...WWWW....WWWW...',
      '..WWYYYYYYYYYYWW..',
      '.WWYYKYYYYYYKYYWW.',
      'WWYYKYYEYYYKYYYEWW',
      '.WWYYKYYYYYYKYYWW.',
      '..WWYYYYYYYYYYWW..',
      '...WWWWWWWWWWWW...',
      '....WW......WW....',
    ];
    const wingsDown = [
      '.....W......W.....',
      '....WW......WW....',
      '..WWYYYYYYYYYYWW..',
      '.WWYYKYYYYYYKYYWW.',
      'WWYYKYYEYYYKYYYEWW',
      '.WWYYKYYYYYYKYYWW.',
      '..WWYYYYYYYYYYWW..',
      '....WW......WW....',
      '.....W......W.....',
    ];
    const art = frame === 0 ? wingsUp : wingsDown;
    const indent = Math.max(0, Math.floor((width - 18) / 2));
    const pad = ' '.repeat(indent);
    return art.map(
      (row) =>
        pad +
        row
          .split('')
          .map((ch) => (ch === '.' ? ' ' : (pal[ch] ?? '') + '█' + RST))
          .join('')
    );
  }

  /** §22.12-style empty state: animated bee + dedicated copy. */
  private renderEmptyState(lines: string[], w: number): void {
    const frame = (Math.floor(Date.now() / 150) % 2) as 0 | 1;
    lines.push('');
    lines.push(...this.renderBee(w, frame));
    lines.push('');
    lines.push(truncateToWidth(this.theme.fg('accent', '  NO WORKERS — swarm is idle'), w));
    lines.push(truncateToWidth(this.theme.fg('dim', '  Press S to start the supervisor.'), w));
    lines.push(
      truncateToWidth(
        this.theme.fg('dim', '  Configure pools: pi-ultra-messenger setup   /messenger config'),
        w
      )
    );
  }

  /** §22.3 — human label for why the pool is idle or capped. */
  private idleLabel(config: MessengerConfig, running: SpawnedAgent[]): string {
    if (!config.supervisor.enabled) return 'supervisor disabled — press S to start';
    if (config.supervisor.paused) return 'paused — press P to resume';
    if (running.length >= config.maxConcurrentSpawns) return 'capped — capacity full';
    const reason = this.lastSnapshot?.lastReason;
    if (reason) {
      const map: Record<string, string> = {
        disabled: 'supervisor disabled',
        paused: 'paused',
        capacity_full: 'capped — capacity full',
        no_ready_beads: 'idle — no ready work',
        awaiting_enrichment: 'awaiting enrichment',
        quality_gate_failed: 'quality gate failed',
        workers_selecting_work: 'workers selecting work',
        model_unavailable: 'model unavailable',
        no_enabled_pools: 'no enabled pools',
        error: 'supervisor error',
      };
      const mapped = map[reason];
      if (mapped) return mapped;
      return reason;
    }
    return running.length > 0 ? 'running' : 'idle';
  }

  private fmtTime(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString();
  }

  /** §22.8 — responsive width tier. */
  private tier(w: number): 'compact' | 'standard' | 'wide' {
    if (w < 72) return 'compact';
    if (w < 120) return 'standard';
    return 'wide';
  }

  /** Truncate + right-pad a plain (non-ANSI) string to a fixed cell width. */
  private pad(s: string, n: number): string {
    const v = s.length > n ? s.slice(0, n) : s;
    return v + ' '.repeat(Math.max(0, n - v.length));
  }

  private fmtElapsed(iso: string): string {
    const ms = Math.max(0, Date.now() - new Date(iso).getTime());
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm' + (s % 60) + 's';
    const h = Math.floor(m / 60);
    return h + 'h' + (m % 60) + 'm';
  }

  // --- Component interface ---
  render(width: number): string[] {
    if (this.focused) this.startAnimation();
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

    let panelLines: string[];
    if (this.helpMode) {
      panelLines = this.renderHelp(w);
    } else if (this.detailMode && this.currentPanel === 'workers') {
      const vis = this.searchQuery
        ? running.filter((wk) => this.matchesQuery(wk, this.searchQuery))
        : running;
      const sel = vis[Math.min(this.selectedWorkerIndex, Math.max(0, vis.length - 1))];
      panelLines = sel
        ? this.renderWorkerDetail(sel, liveWorkers, w)
        : this.renderPanel(this.currentPanel, w, config, workers, running, liveWorkers);
    } else {
      panelLines = this.renderPanel(this.currentPanel, w, config, workers, running, liveWorkers);
    }
    if (this.searchMode && this.currentPanel === 'workers') {
      panelLines = [
        this.theme.fg('accent', '  /' + this.searchQuery + '_  (Esc cancel · Enter apply)'),
        ...panelLines,
      ];
    }
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
    this.startAnimation();
  }

  blur(): void {
    this.focused = false;
    this.stopAnimation();
  }

  isFocused(): boolean {
    return this.focused;
  }

  handleInput(data: string): void {
    // §22.9 — ? help overlay (modal; q falls through to close)
    if (this.helpMode) {
      if (data === '\x1b' || data === '?') {
        this.helpMode = false;
        return;
      }
      if (data !== 'q') return;
      this.helpMode = false;
    }

    // §22.9 — / search input (modal)
    if (this.searchMode) {
      if (data === '\x1b') {
        this.searchMode = false;
        this.searchQuery = '';
        return;
      }
      if (data === '\r' || data === '\n') {
        this.searchMode = false; // keep query as active filter
        return;
      }
      if (data === '\x7f' || data === '\b') {
        this.searchQuery = this.searchQuery.slice(0, -1);
        return;
      }
      if (data.length === 1 && data >= ' ') {
        this.searchQuery += data;
        return;
      }
      return;
    }

    // §22.9 — Esc closes detail before closing the overlay
    if (this.detailMode && data === '\x1b') {
      this.detailMode = false;
      return;
    }

    // Enter — toggle worker detail (Workers panel)
    if (data === '\r' || data === '\n') {
      if (this.detailMode) {
        this.detailMode = false;
        return;
      }
      if (this.currentPanel === 'workers') {
        const running = this.filteredRunning();
        if (running.length > 0) {
          this.selectedWorkerIndex = Math.min(this.selectedWorkerIndex, running.length - 1);
          this.detailMode = true;
        }
      }
      return;
    }

    // / — enter search (Workers panel)
    if (data === '/' && this.currentPanel === 'workers') {
      this.searchMode = true;
      this.searchQuery = '';
      return;
    }

    // ? — toggle help
    if (data === '?') {
      this.helpMode = !this.helpMode;
      return;
    }

    // Tab — cycle panels
    if (data === '\t') {
      const idx = PANELS.indexOf(this.currentPanel);
      this.currentPanel = PANELS[(idx + 1) % PANELS.length];
      this.selectedWorkerIndex = 0;
      this.detailMode = false;
      this.searchMode = false;
      this.searchQuery = '';
      return;
    }

    // Number keys 1-5 — jump to panel
    const numKey = parseInt(data, 10);
    if (numKey >= 1 && numKey <= 5) {
      this.currentPanel = PANELS[numKey - 1];
      this.selectedWorkerIndex = 0;
      this.detailMode = false;
      this.searchMode = false;
      this.searchQuery = '';
      return;
    }

    // j/k — navigate the (filtered) worker list
    if (data === 'j' || data === 'k') {
      if (this.currentPanel === 'workers') {
        const running = this.filteredRunning();
        if (data === 'j' && this.selectedWorkerIndex < running.length - 1)
          this.selectedWorkerIndex++;
        if (data === 'k' && this.selectedWorkerIndex > 0) this.selectedWorkerIndex--;
      }
      return;
    }

    // ro (two-key) aliases v for view-only toggle, per the control-plane plan.
    if (this.pendingTwoKey === 'ro') {
      this.pendingTwoKey = null;
      if (data === 'o') {
        this.viewOnly = !this.viewOnly;
        this.lastControlMsg = this.viewOnly ? 'view-only on' : 'view-only off';
        return;
      }
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

    // Supervisor control keys (global; disabled in view-only mode)
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
      this.stopAnimation();
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
    const title =
      this.tier(w) === 'compact'
        ? 'Swarm Control Plane'
        : 'pi-ultra-messenger · Swarm Control Plane';
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
      ? truncateToWidth(
          this.theme.fg('dim', '  [view-only] mutating keys disabled (v to toggle)'),
          w
        )
      : truncateToWidth(
          this.theme.fg('dim', '  [S]tart [p]ause [P]resume [s]top · v:view-only'),
          w
        );
    lines.push(
      '',
      truncateToWidth(
        `Supervisor: ${supGlyph}${supLabel}  Workers ${running.length}/${config.maxConcurrentSpawns} ${headroom}`,
        w
      )
    );
    lines.push(ctrlHints);
    if (this.pendingConfirm)
      lines.push(this.theme.fg('accent', `  ${this.pendingConfirm} supervisor? [y/N]`));
    if (this.lastControlMsg) lines.push(this.theme.fg('dim', `  → ${this.lastControlMsg}`));

    // §22.3 — why idle / why capped, ready count, tick cadence
    lines.push('', '## Status');
    lines.push(truncateToWidth(`  Why: ${this.idleLabel(config, running)}`, w));
    const ready = this.lastSnapshot?.lastReadyCount;
    lines.push(truncateToWidth(`  Ready: ${ready === undefined ? '—' : ready}`, w));
    lines.push(truncateToWidth(`  Last tick: ${this.fmtTime(this.lastSnapshot?.lastTickAt)}`, w));
    lines.push(truncateToWidth(`  Next tick: ${this.fmtTime(this.lastSnapshot?.nextTickAt)}`, w));
    if (this.lastSnapshot?.lastError)
      lines.push(truncateToWidth(this.theme.fg('error', `  ! ${this.lastSnapshot.lastError}`), w));

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

    if (config.supervisor.workerPools.length > 0 && this.tier(w) !== 'compact') {
      lines.push('', '## Pools');
      for (const pool of config.supervisor.workerPools) {
        const model = pool.model.mode === 'inherit' ? 'inherit' : pool.model.model;
        const state = pool.enabled ? 'on' : 'off';
        lines.push(`  ${pool.id}: ${pool.workers}w · ${model} · ${state}`);
      }
    }

    if (running.length === 0 && workers.length === 0) {
      this.renderEmptyState(lines, w);
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

    // §22.4 — column layout, tier-aware. §22.10 — search filter.
    const visible = this.searchQuery
      ? running.filter((wk) => this.matchesQuery(wk, this.searchQuery))
      : running;
    if (visible.length === 0) {
      lines.push('', this.theme.fg('dim', '  No workers match "' + this.searchQuery + '".'));
      return lines;
    }

    const liveArr = Array.from(liveWorkers.values());
    const liveByName = new Map<string, (typeof liveArr)[number]>();
    for (const lw of liveArr) liveByName.set(lw.name, lw);

    const t = this.tier(w);
    const cols =
      t === 'wide'
        ? ['NAME', 'POOL', 'BEAD', 'PHASE', 'MODEL', 'ELAPSED', 'TKS']
        : t === 'compact'
          ? ['NAME', 'PHASE', 'ELAPSED']
          : ['NAME', 'POOL', 'PHASE', 'MODEL', 'ELAPSED'];
    const cw: Record<string, number> = {
      NAME: t === 'compact' ? 14 : 16,
      POOL: 10,
      BEAD: 12,
      PHASE: 12,
      MODEL: 14,
      ELAPSED: 7,
      TKS: 5,
    };
    const cell = (s: string, c: string) => this.pad(s, cw[c] ?? 8);

    lines.push('', '## Running Workers');
    lines.push(this.theme.fg('dim', '    ' + cols.map((c) => cell(c, c)).join('  ')));
    for (let i = 0; i < visible.length; i++) {
      const worker = visible[i];
      const sel = i === this.selectedWorkerIndex ? '▸' : ' ';
      const sym = worker.status === 'running' ? '●' : '○';
      const lw = liveByName.get(worker.name);
      const vals: Record<string, string> = {
        NAME: worker.name,
        POOL: worker.poolId ?? '—',
        BEAD: worker.currentBeadId ?? '—',
        PHASE: worker.phase ?? '—',
        MODEL: worker.model ?? '—',
        ELAPSED: this.fmtElapsed(worker.startedAt),
        TKS: lw?.progress?.tokens != null ? String(lw.progress.tokens) : '—',
      };
      const row = `${sel} ${sym} ` + cols.map((c) => cell(vals[c] ?? '—', c)).join('  ');
      lines.push(truncateToWidth(row, w));
    }

    // Live workers (in-progress, not yet in spawned list)
    const liveNames = new Set(running.map((wk) => wk.name));
    const extraLive = liveArr.filter((lw) => !liveNames.has(lw.name));
    if (extraLive.length > 0) {
      lines.push('', '## Starting');
      for (const lw of extraLive.slice(0, 5)) {
        const activity = lw.progress.currentTool ? lw.progress.currentTool : 'thinking';
        lines.push(truncateToWidth(`  ↻ ${lw.name} — ${activity}`, w));
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
    const max = this.tier(w) === 'wide' ? 20 : this.tier(w) === 'compact' ? 10 : 15;
    for (const worker of workers.slice(0, max)) {
      const status =
        worker.status === 'completed'
          ? '✓'
          : worker.status === 'failed'
            ? '✗'
            : worker.status === 'stopped'
              ? '■'
              : worker.status === 'running'
                ? '●'
                : '○';
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

  /** §22.10 — running workers matching the active search query. */
  private filteredRunning(): SpawnedAgent[] {
    const running = listSpawned(this.cwd, SUPERVISOR_SESSION, true).filter(
      (w) => w.status === 'running'
    );
    if (!this.searchQuery) return running;
    return running.filter((w) => this.matchesQuery(w, this.searchQuery));
  }

  private matchesQuery(w: SpawnedAgent, q: string): boolean {
    const ql = q.toLowerCase();
    return [w.name, w.poolId, w.currentBeadId, w.phase, w.model, w.status]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(ql));
  }

  /** §22.4 detail pane — full record for the selected worker. */
  private renderWorkerDetail(
    worker: SpawnedAgent,
    liveWorkers: ReturnType<typeof getLiveWorkers>,
    w: number
  ): string[] {
    const lines: string[] = [];
    const lw = Array.from(liveWorkers.values()).find((l) => l.name === worker.name);
    const recentArr = lw?.progress?.recentTools ?? [];
    const recent =
      recentArr
        .slice(-6)
        .map((t) => '    ' + t)
        .join('\n') || '    (none)';
    const mode = lw ? 'attached' : 'detached';
    const row = (label: string, value: string) => truncateToWidth(`  ${label}: ${value}`, w);
    lines.push('', this.theme.fg('accent', '## Worker Detail'));
    lines.push(row('spawn ID', worker.id));
    lines.push(row('name', worker.name + ' (' + worker.role + ')'));
    lines.push(row('PID', worker.pid != null ? String(worker.pid) : '—'));
    lines.push(row('session', worker.sessionId ?? '—'));
    lines.push(row('requested model', worker.model ?? '—'));
    lines.push(row('actual model', worker.actualModel ?? '—'));
    lines.push(row('claimed bead', worker.currentBeadId ?? '—'));
    lines.push(row('reported task', lw?.taskId ?? '—'));
    lines.push(row('phase', worker.phase ?? '—'));
    lines.push(row('status', worker.status));
    lines.push(row('status msg', worker.statusMessage ?? '—'));
    lines.push(row('runtime mode', mode));
    lines.push(row('started', new Date(worker.startedAt).toLocaleTimeString()));
    lines.push(row('ended', worker.endedAt ? new Date(worker.endedAt).toLocaleTimeString() : '—'));
    lines.push(row('exit', worker.exitCode != null ? String(worker.exitCode) : '—'));
    lines.push(row('error', worker.error ?? '—'));
    lines.push(this.theme.fg('dim', '  recent tools:'));
    lines.push(this.theme.fg('dim', recent));
    return lines;
  }

  /** §22.9 — keybind help overlay. */
  private renderHelp(w: number): string[] {
    const lines: string[] = [];
    const entry = (k: string, d: string) => this.theme.fg('dim', this.pad(k, 10) + '  ' + d);
    lines.push('', this.theme.fg('accent', '## Help — /swarm keybinds'));
    lines.push(entry('1-5', 'switch panel (Overview/Workers/Pools/Activity/Diagnostics)'));
    lines.push(entry('Tab', 'cycle panels'));
    lines.push(entry('j/k', 'move selection (Workers)'));
    lines.push(entry('Enter', 'open / close worker detail (Workers)'));
    lines.push(entry('/', 'search workers (name/pool/bead/phase/model/status)'));
    lines.push(entry('?', 'toggle this help'));
    lines.push(entry('S/p/P/s', 'start / pause / resume / stop supervisor'));
    lines.push(entry('v', 'toggle view-only (disables mutating keys)'));
    lines.push(entry('b', 'background — snapshot without closing'));
    lines.push(entry('q/Esc', 'close overlay (Esc closes detail/search/help first)'));
    return lines;
  }

  private renderFooter(w: number): string {
    const hints = this.viewOnly
      ? 'v:view-only · Tab/1-5 · j/k · Enter:detail · /:search · ?:help · q:quit'
      : 'S:start p:pause P:resume s:stop · v · Tab/1-5 · j/k · Enter · / · ? · b:bg · q:quit';
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
