import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Dirs, MessengerState } from '../../lib.js';
import { extractFolder, truncatePathLeft } from '../../lib.js';
import * as store from '../../store.js';
import { notRegisteredError, result } from '../result.js';

export function executeStatus(state: MessengerState, dirs: Dirs, cwd: string = process.cwd()) {
  if (!state.registered) {
    return notRegisteredError();
  }

  const agents = store.getActiveAgents(state, dirs);
  const folder = extractFolder(cwd);
  const location = state.gitBranch ? `${folder} (${state.gitBranch})` : folder;

  let text = `You: ${state.agentName}\n`;
  text += `Location: ${location}\n`;
  text += `Peers: ${agents.length}\n`;
  if (state.reservations.length > 0) {
    const myRes = state.reservations.map((r) => `🔒 ${truncatePathLeft(r.pattern, 40)}`);
    text += `Reservations: ${myRes.join(', ')}\n`;
  }
  text += '\nUse `pi-messenger-swarm list` for details, `pi-messenger-swarm swarm` for worker pool status.';

  return result(text, {
    mode: 'status',
    registered: true,
    self: state.agentName,
    folder,
    gitBranch: state.gitBranch,
    peerCount: agents.length,
    reservations: state.reservations,
  });
}

export function executeSetStatus(
  state: MessengerState,
  dirs: Dirs,
  ctx: ExtensionContext,
  message: string
) {
  if (!state.registered) {
    return notRegisteredError();
  }

  state.statusMessage = message;
  state.customStatus = true;
  store.updateRegistration(state, dirs, ctx);

  return result(`Status set to: ${message}`, { mode: 'set_status', message });
}
