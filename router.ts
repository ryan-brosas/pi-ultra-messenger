/**
 * pi-messenger-swarm action router.
 *
 * Coordination surfaces (task/feed/send/reserve/release/channels/join/whois/rename/set_status)
 * have been removed. Workers coordinate through MCP Agent Mail and follow the target
 * project's AGENTS.md directly.
 *
 * Spawn and swarm do NOT require registration — they work from a clean project
 * with no agent mesh. Status and list remain agent-presence views and still
 * require registration. Removed actions return removed_action regardless of
 * registration state.
 */

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { MessengerState, Dirs } from './lib.js';
import * as handlers from './handlers.js';
import type { MessengerActionParams } from './action-types.js';
import type { WorkerPhase } from './swarm/types.js';
import { result } from './swarm/result.js';
import { executeSpawn, executeSwarmStatus } from './swarm/handlers.js';
import { getEffectiveSessionId } from './store/shared.js';
import { updateSpawnStatus } from './swarm/spawn.js';

export interface RouterConfig {
  maxConcurrentSpawns?: number;
}

const REMOVED_ACTIONS = new Set([
  'task', 'feed', 'send', 'reserve', 'release', 'channels',
  'join', 'whois', 'rename', 'set_status', 'broadcast',
  'claim', 'unclaim', 'complete', 'autoRegisterPath',
]);

export async function executeAction(
  action: string,
  params: MessengerActionParams,
  state: MessengerState,
  dirs: Dirs,
  ctx: ExtensionContext,
  _deliverMessage: (msg: unknown) => void,
  _updateStatus: (ctx: ExtensionContext) => void,
  _appendEntry?: (type: string, data: unknown) => void,
  config?: RouterConfig,
  _signal?: AbortSignal
) {
  const dotIndex = action.indexOf('.');
  const group = dotIndex > 0 ? action.slice(0, dotIndex) : action;
  const op = dotIndex > 0 ? action.slice(dotIndex + 1) : null;
  const cwd = ctx.cwd ?? process.cwd();
  const sessionId = getEffectiveSessionId(cwd, state);

  // Removed actions return removed_action regardless of registration
  if (REMOVED_ACTIONS.has(group)) {
    return result(
      `Unknown or removed action: ${action}. ` +
        'Coordination surfaces (task/feed/send/reserve/release/channels/join/whois/rename/set_status) have been removed. ' +
        'Use MCP Agent Mail for coordination and the target project AGENTS.md for workflow rules.',
      {
        mode: 'error',
        error: 'removed_action',
        action,
      }
    );
  }

  // Spawn, swarm, and worker telemetry work without registration
  switch (group) {
    case 'spawn':
      return executeSpawn(op, params, state, cwd, sessionId, config?.maxConcurrentSpawns);

    case 'swarm':
      return executeSwarmStatus(cwd, state.currentChannel || '', sessionId);

    case 'worker':
      if (op === 'status') {
        const spawnId = (params.id || params.message) as string | undefined;
        if (!spawnId) {
          return result('Error: worker status requires an id.', { mode: 'worker.status', error: 'missing_id' });
        }
        const updated = updateSpawnStatus(cwd, spawnId, {
          phase: params.phase as WorkerPhase | undefined,
          currentBeadId: params.taskId,
          statusMessage: params.message,
          agentMailName: params.name,
        });
        if (!updated) {
          return result(`Error: worker ${spawnId} not found.`, { mode: 'worker.status', error: 'not_found' });
        }
        return result(`Status updated for ${updated.name}.`, { mode: 'worker.status', agent: updated });
      }
      return result(`Unknown worker operation: ${op}`, { mode: 'error', error: 'unknown_operation' });
  }

  // Status and list require registration (agent-presence views)
  if (!state.registered) {
    return handlers.notRegisteredError();
  }

  switch (group) {
    case 'status':
      return handlers.executeStatus(state, dirs, cwd);

    case 'list':
      return handlers.executeList(state, dirs, cwd, {});

    default:
      return result(
        `Unknown or removed action: ${action}. ` +
          'Coordination surfaces (task/feed/send/reserve/release/channels/join/whois/rename/set_status) have been removed. ' +
          'Use MCP Agent Mail for coordination and the target project AGENTS.md for workflow rules.',
        {
          mode: 'error',
          error: 'removed_action',
          action,
        }
      );
  }
}
