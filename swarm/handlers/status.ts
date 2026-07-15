import { displayChannelLabel, normalizeChannelId } from '../../channel.js';
import { result } from '../result.js';
import { cleanupExitedSpawned, listSpawnedHistory, reconcileSpawnedAgents } from '../spawn.js';
import { formatRoleLabel } from '../labels.js';

export function executeSwarmStatus(cwd: string, channelId: string, sessionId: string) {
  cleanupExitedSpawned(cwd, sessionId);
  reconcileSpawnedAgents(cwd, sessionId);
  const allAgents = listSpawnedHistory(cwd, sessionId);
  const runningAgents = allAgents.filter((a) => a.status === 'running');
  const completedCount = allAgents.filter((a) => a.status === 'completed').length;
  const failedCount = allAgents.filter((a) => a.status === 'failed').length;
  const channelLabel = displayChannelLabel(channelId);

  if (runningAgents.length === 0 && completedCount === 0 && failedCount === 0) {
    let text = `# Worker Pool ${channelLabel}\n\nNo workers running.`;
    text += `\n\nSpawn one:\n  pi-ultra-messenger spawn --role Researcher "Investigate ..."`;
    return result(text, {
      mode: 'swarm',
      channel: normalizeChannelId(channelId),
      spawned: [],
    });
  }

  const lines: string[] = [`# Worker Pool ${channelLabel}`, ''];

  if (runningAgents.length > 0) {
    lines.push('## Running Workers');
    for (const agent of runningAgents.slice(0, 8)) {
      lines.push(`- ${agent.id} · ${agent.name} (${formatRoleLabel(agent.role)}) · ${agent.status}`);
    }
    lines.push('');
  }

  if (completedCount > 0 || failedCount > 0) {
    lines.push('## Worker History');
    lines.push(`- ${completedCount} completed · ${failedCount} failed`);
    lines.push('- View: pi-ultra-messenger spawn history');
    lines.push('');
  }

  return result(lines.join('\n'), {
    mode: 'swarm',
    channel: normalizeChannelId(channelId),
    spawned: runningAgents,
  });
}
