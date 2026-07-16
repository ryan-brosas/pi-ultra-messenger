/**
 * Pi Messenger Extension
 *
 * Enables pi agents to discover and communicate with each other across terminal sessions.
 * Uses file-based coordination with a harness server for action dispatch.
 *
 * Architecture:
 * - This extension manages lifecycle hooks (registration, status, overlay, reservations)
 * - A long-lived harness server (pi-ultra-messenger) handles all action dispatch
 * - Models interact via the CLI, not a tool call — no eager invocation risk
 * - The SKILL.md teaches models how to use the CLI
 */

import * as fs from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { OverlayHandle, TUI } from '@earendil-works/pi-tui';
import { truncateToWidth } from '@earendil-works/pi-tui';
import {
  type MessengerState,
  type Dirs,
  type AgentMailMessage,
  formatRelativeTime,
  stripAnsiCodes,
  extractFolder,
} from './lib.js';
import { displayChannelLabel } from './channel.js';
import * as store from './store.js';
import { getContextSessionId, getEffectiveSessionId } from './store/shared.js';
import { syncChannelStateFromDisk } from './store/agents.js';
import { MessengerOverlay, type OverlayCallbacks } from './overlay/component.js';
import { MessengerConfigOverlay } from './overlay/config-overlay.js';
import { loadConfig, matchesAutoRegisterPath, type MessengerConfig } from './config.js';
import { logFeedEvent, pruneFeed } from './feed/index.js';
import { onLiveWorkersChanged } from './swarm/live-progress.js';
import { stopAllSpawned } from './swarm/spawn.js';
import { listSpawned } from './swarm/spawn.js';
import { createDeliverMessage } from './extension/deliver-message.js';
import { createStatusController } from './extension/status.js';
import { createActivityTracker } from './extension/activity.js';
import { installShellAlias, createHarnessServer } from './extension/harness.js';
import { handleReservationEnforcement } from './extension/reservation.js';
import { handleSessionShutdown } from './extension/shutdown.js';

let overlayTui: TUI | null = null;
let overlayHandle: OverlayHandle | null = null;
let overlayOpening = false;

export default function piMessengerExtension(pi: ExtensionAPI) {
  const config: MessengerConfig = loadConfig(process.cwd());

  const state: MessengerState = {
    agentName: '',
    registered: false,
    reservations: [],
    chatHistory: new Map(),
    unreadCounts: new Map(),
    channelPostHistory: [],
    seenSenders: new Map(),
    model: '',
    gitBranch: undefined,
    spec: undefined,
    scopeToFolder: config.scopeToFolder,
    isHuman: false,
    session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: new Date().toISOString() },
    statusMessage: undefined,
    customStatus: false,
    registryFlushTimer: null,
    sessionStartedAt: new Date().toISOString(),
    contextSessionId: undefined,
    currentChannel: '',
    sessionChannel: '',
    joinedChannels: [],
  };

  const nameTheme = { theme: config.nameTheme, customWords: config.nameWords };

  function getMessengerDirs(): Dirs {
    const baseDir =
      process.env.PI_MESSENGER_DIR ||
      (process.env.PI_MESSENGER_GLOBAL === '1'
        ? join(getAgentDir(), 'messenger')
        : join(process.cwd(), '.pi/messenger'));
    return {
      base: baseDir,
      registry: join(baseDir, 'registry'),
    };
  }
  const dirs = getMessengerDirs();

  const deliverMessage = createDeliverMessage({
    pi,
    state,
    dirs,
    config,
    requestRender: () => overlayTui?.requestRender(),
  });

  const { updateStatus, clearAllUnreadCounts, resetChannelScopedUiState } = createStatusController({
    state,
    dirs,
    config,
    maybeAutoOpenSwarmOverlay,
  });

  function syncContextSession(ctx: ExtensionContext): void {
    if (!state.registered) return;

    const rebound = store.rebindContextSession(state, dirs, ctx);
    if (!rebound.changed) return;

    const cwd = ctx.cwd ?? process.cwd();
    if (rebound.previousSessionChannel && rebound.previousSessionChannel !== state.sessionChannel) {
      logFeedEvent(
        cwd,
        state.agentName,
        'leave',
        undefined,
        undefined,
        rebound.previousSessionChannel
      );
    }

    resetChannelScopedUiState();
    logFeedEvent(cwd, state.agentName, 'join', undefined, undefined, state.currentChannel);
    overlayTui?.requestRender();
    updateStatus(ctx);
  }

  const STATUS_HEARTBEAT_MS = 15_000;
  let latestCtx: ExtensionContext | null = null;
  let statusHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function startStatusHeartbeat(): void {
    if (statusHeartbeatTimer) return;
    statusHeartbeatTimer = setInterval(() => {
      if (latestCtx) updateStatus(latestCtx);
    }, STATUS_HEARTBEAT_MS);
  }

  function stopStatusHeartbeat(): void {
    if (!statusHeartbeatTimer) return;
    clearInterval(statusHeartbeatTimer);
    statusHeartbeatTimer = null;
  }

  onLiveWorkersChanged(() => {
    if (latestCtx) updateStatus(latestCtx);
    overlayTui?.requestRender();
  });

  function sendRegistrationContext(ctx: ExtensionContext): void {
    const folder = extractFolder(process.cwd());
    const locationPart = state.gitBranch ? `${folder} on ${state.gitBranch}` : folder;

    pi.sendMessage(
      {
        customType: 'messenger_context',
        content: `You are agent "${state.agentName}" in ${locationPart}. Use pi-ultra-messenger for spawn/status/list. Workers coordinate through MCP Agent Mail and follow the target project's AGENTS.md. Examples: pi-ultra-messenger swarm | pi-ultra-messenger spawn --role Researcher "Analyze X" | pi-ultra-messenger spawn list. Task/feed/send/reserve commands have been removed — use MCP Agent Mail for coordination. See SKILL for full reference.`,
        display: false,
      },
      { triggerTurn: false }
    );
  }

  const harnessServer = createHarnessServer(dirs.base);

  pi.registerCommand('messenger', {
    description: "Open messenger overlay, or 'config' to manage settings",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      latestCtx = ctx;
      syncContextSession(ctx);

      // /messenger config - open config overlay
      if (args[0] === 'config') {
        await ctx.ui.custom<void>(
          (tui, theme, _keybindings, done) => {
            return new MessengerConfigOverlay(tui, theme, done);
          },
          { overlay: true }
        );
        return;
      }

      // /messenger - open chat overlay (auto-joins if not registered)
      if (!state.registered) {
        if (!store.register(state, dirs, ctx, nameTheme)) {
          ctx.ui.notify('Failed to join agent mesh', 'error');
          return;
        }
        updateStatus(ctx);
        if (config.registrationContext) {
          sendRegistrationContext(ctx);
        }
      }

      // Sync channel state from disk so the overlay opens on the
      // most recent active channel (e.g. a named channel the agent
      // joined via the CLI), not a stale session channel.
      syncChannelStateFromDisk(state, dirs);

      if (overlayHandle && overlayHandle.isHidden()) {
        overlayHandle.setHidden(false);
        clearAllUnreadCounts();
        updateStatus(ctx);
        return;
      }

      const callbacks: OverlayCallbacks = {
        onBackground: (snapshotText) => {
          overlayHandle?.setHidden(true);
          pi.sendMessage(
            {
              customType: 'swarm_snapshot',
              content: snapshotText,
              display: true,
            },
            { triggerTurn: true }
          );
        },
        onSwitchChannel: (channelId) => {
          const switched = store.joinChannel(state, dirs, channelId, { create: true });
          if (!switched.success) return false;
          resetChannelScopedUiState();
          updateStatus(ctx);
          return true;
        },
      };

      const snapshot = await ctx.ui.custom<string | undefined>(
        (tui, theme, _keybindings, done) => {
          overlayTui = tui;
          return new MessengerOverlay(tui, theme, state, dirs, done, callbacks);
        },
        {
          overlay: true,
          onHandle: (handle) => {
            overlayHandle = handle;
          },
        }
      );

      if (snapshot) {
        pi.sendMessage(
          {
            customType: 'swarm_snapshot',
            content: snapshot,
            display: true,
          },
          { triggerTurn: true }
        );
      }

      // Overlay closed
      clearAllUnreadCounts();
      overlayHandle = null;
      overlayTui = null;
      updateStatus(ctx);
    },
  });

  pi.registerCommand('swarm', {
    description: 'Open worker pool overlay (Overview, Workers, Pools, Diagnostics)',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      latestCtx = ctx;

      const config = loadConfig(process.cwd());
      const sessionId = 'pi-swarm-supervisor';
      const workers = listSpawned(process.cwd(), sessionId, true);
      const running = workers.filter((w) => w.status === 'running');
      const completed = workers.filter((w) => w.status === 'completed');
      const failed = workers.filter((w) => w.status === 'failed');

      const lines: string[] = [];
      lines.push('# Worker Pool', '');

      // Overview
      lines.push('## Overview');
      lines.push(`Running: ${running.length}  Completed: ${completed.length}  Failed: ${failed.length}`);
      lines.push(`Max concurrent: ${config.maxConcurrentSpawns}`);
      lines.push(`Supervisor: ${config.supervisor.enabled ? 'enabled' : 'disabled'}${config.supervisor.paused ? ' (paused)' : ''}`);
      lines.push('');

      // Workers
      if (running.length > 0) {
        lines.push('## Running Workers');
        for (const w of running.slice(0, 10)) {
          const phase = w.phase ? ` · ${w.phase}` : '';
          const bead = w.currentBeadId ? ` → ${w.currentBeadId}` : '';
          const msg = w.statusMessage ? ` — ${w.statusMessage}` : '';
          lines.push(`  ${w.name} (${w.role})${phase}${bead}${msg}`);
        }
        lines.push('');
      }

      // Pools
      if (config.supervisor.workerPools.length > 0) {
        lines.push('## Pools');
        for (const pool of config.supervisor.workerPools) {
          const model = pool.model.mode === 'inherit' ? 'inherit' : pool.model.model;
          const state = pool.enabled ? 'enabled' : 'disabled';
          lines.push(`  ${pool.id}: ${pool.workers} workers · ${model} · ${state}`);
        }
        lines.push('');
      }

      // Diagnostics
      lines.push('## Diagnostics');
      lines.push(`Project: ${process.cwd()}`);
      lines.push(`AGENTS.md: ${fs.existsSync(join(process.cwd(), 'AGENTS.md')) ? 'found' : 'not found'}`);
      lines.push(`Supervisor session: ${sessionId}`);

      pi.sendMessage(
        {
          customType: 'swarm_snapshot',
          content: lines.join('\n'),
          display: true,
        },
        { triggerTurn: true }
      );
    },
  });

  pi.registerMessageRenderer<AgentMailMessage>('agent_message', (message, _options, theme) => {
    const details = message.details;
    if (!details) return undefined;

    return {
      render(width: number): string[] {
        const safeFrom = stripAnsiCodes(details.from);
        const safeText = stripAnsiCodes(details.text);

        const header = theme.fg('accent', `From ${safeFrom}`);
        const time = theme.fg('dim', ` (${formatRelativeTime(details.timestamp)})`);

        const result: string[] = [];
        result.push(truncateToWidth(header + time, width));
        result.push('');

        for (const line of safeText.split('\n')) {
          result.push(truncateToWidth(line, width));
        }

        return result;
      },
      invalidate() {},
    };
  });

  const activityTracker = createActivityTracker({ state, dirs, config });

  pi.on('tool_call', async (event, ctx) => {
    await activityTracker.handleToolCall(event, ctx);
  });

  pi.on('tool_result', async (event, ctx) => {
    await activityTracker.handleToolResult(event, ctx);
  });

  pi.on('session_start', async (_event, ctx) => {
    latestCtx = ctx;
    startStatusHeartbeat();
    state.isHuman = ctx.hasUI;
    try {
      fs.rmSync(join(getAgentDir(), 'messenger/feed.jsonl'), { force: true });
    } catch {}

    syncContextSession(ctx);

    // Write the session ID to disk so the harness server (and CLI)
    // can discover it. The harness runs as a separate process and
    // has no access to pi's SessionManager — this file bridges that gap.
    //
    // IMPORTANT: Skip for spawned subagents (PI_SWARM_SPAWNED=1).
    // Subagents share the same project directory as the parent, so
    // writing their session ID would overwrite the parent's file.
    // The next parent CLI call would then read the child's session ID
    // and trigger a spurious session-mismatch reset, creating orphan
    // session channels.
    const sessionId = getContextSessionId(ctx);
    if (sessionId && !process.env.PI_SWARM_SPAWNED) {
      try {
        const sessionFilePath = join(dirs.base, 'session-id');
        fs.writeFileSync(sessionFilePath, sessionId, 'utf-8');
      } catch {
        // Best effort
      }
    }

    // Install the CLI wrapper so all child bash processes
    // can find and use pi-ultra-messenger.
    installShellAlias();

    const shouldAutoRegister =
      config.autoRegister || matchesAutoRegisterPath(process.cwd(), config.autoRegisterPaths);

    // Start the harness server even without auto-register —
    // the model needs it for CLI actions regardless.
    if (!process.env.PI_SWARM_SPAWNED) {
      harnessServer.start();
    }

    if (!shouldAutoRegister) {
      maybeAutoOpenSwarmOverlay(ctx);
      return;
    }

    const wasRegistered = state.registered;
    if (store.register(state, dirs, ctx, nameTheme)) {
      updateStatus(ctx);
      if (!wasRegistered) {
        const cwd = ctx.cwd ?? process.cwd();
        pruneFeed(cwd, config.feedRetention, state.currentChannel);
        logFeedEvent(cwd, state.agentName, 'join', undefined, undefined, state.currentChannel);
      }

      if (config.registrationContext) {
        sendRegistrationContext(ctx);
      }
    }

    maybeAutoOpenSwarmOverlay(ctx);
  });

  function maybeAutoOpenSwarmOverlay(_ctx: ExtensionContext): void {
    // Swarm mode intentionally disables planning/autonomous auto-overlay behavior.
  }

  pi.on('session_start', async (event, ctx) => {
    // Handle new, resume, and fork reasons (existing sessions), not startup/reload
    if (event.reason === 'startup' || event.reason === 'reload') return;
    latestCtx = ctx;
    syncContextSession(ctx);
    updateStatus(ctx);
    maybeAutoOpenSwarmOverlay(ctx);
  });
  pi.on('session_tree', async (_event, ctx) => {
    latestCtx = ctx;
    updateStatus(ctx);
    maybeAutoOpenSwarmOverlay(ctx);
  });

  pi.on('turn_end', async (event, ctx) => {
    latestCtx = ctx;
    syncContextSession(ctx);
    updateStatus(ctx);

    if (state.registered) {
      const msg = event.message as unknown as Record<string, unknown> | undefined;
      if (msg && msg.role === 'assistant' && msg.usage) {
        const usage = msg.usage as { totalTokens?: number; input?: number; output?: number };
        const total = usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0);
        if (total > 0) {
          state.session.tokens += total;
          activityTracker.scheduleRegistryFlush(ctx);
        }
      }
    }

    maybeAutoOpenSwarmOverlay(ctx);
  });

  pi.on('agent_settled', async (_event, ctx) => {
    latestCtx = ctx;
    updateStatus(ctx);
  });

  pi.on('session_shutdown', async () => {
    const cwd = process.cwd();
    stopAllSpawned(cwd); // In-process safety net for extension-spawned agents
    stopStatusHeartbeat();
    // Do NOT send /quit to the harness server on session shutdown.
    // The harness is a long-lived daemon (detached + unref'd) designed to
    // survive across pi sessions. Killing it destroys all spawned subagents
    // that may still be working. The harness handles agent cleanup via its
    // own session tracking — it will unregister this session's agent when
    // handleSessionShutdown runs below. If the harness truly needs to stop,
    // the user can run `pi-ultra-messenger --stop` explicitly.
    harnessServer.stop(); // Only stops the process WE spawned (if any)
    overlayOpening = false;
    overlayHandle = null;
    overlayTui = null;
    await handleSessionShutdown(state, dirs);
    activityTracker.dispose();
  });

  pi.on('tool_call', async (event, ctx) => {
    return handleReservationEnforcement(event, ctx, state, dirs);
  });
}
