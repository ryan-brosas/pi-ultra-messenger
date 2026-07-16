import type { Dirs, MessengerState, AgentRegistration } from '../../lib.js';
import {
  STATUS_INDICATORS,
  computeStatus,
  buildSelfRegistration,
  extractFolder,
} from '../../lib.js';
import * as store from '../../store.js';
import { notRegisteredError, result } from '../result.js';

export function executeList(
  state: MessengerState,
  dirs: Dirs,
  cwd: string,
  _config?: { stuckThreshold?: number }
) {
  if (!state.registered) {
    return notRegisteredError();
  }

  const peers = store.getActiveAgents(state, dirs);
  const folder = extractFolder(cwd);
  const totalCount = peers.length + 1;

  function formatAgentLine(a: AgentRegistration, isSelf: boolean): string {
    const computed = computeStatus(
      a.activity?.lastActivityAt ?? a.startedAt,
      false,
      (a.reservations?.length ?? 0) > 0,
      900 * 1000
    );
    const indicator = STATUS_INDICATORS[computed.status];
    const nameLabel = isSelf ? `${a.name} (you)` : a.name;

    const parts: string[] = [`${indicator} ${nameLabel}`];

    if (a.activity?.currentActivity) {
      parts.push(a.activity.currentActivity);
    } else if (computed.status === 'idle' && computed.idleFor) {
      parts.push(`idle ${computed.idleFor}`);
    }

    const gitInfo = a.gitBranch ? ` (${a.gitBranch})` : '';
    parts.push(a.model || 'unknown');
    parts.push(`${a.pid}${gitInfo}`);

    if (a.statusMessage) parts.push(`— ${a.statusMessage}`);

    return parts.join('  ');
  }

  const lines: string[] = [];
  lines.push(`# Agents (${totalCount} online - project: ${folder})`, '');

  lines.push(formatAgentLine(buildSelfRegistration(state), true));

  for (const a of peers) {
    lines.push(formatAgentLine(a, false));
  }

  lines.push('');
  lines.push('Use `pi-ultra-messenger swarm` for worker pool status.');

  return result(lines.join('\n').trim(), {
    mode: 'list',
    agents: peers,
    totalCount,
  });
}
