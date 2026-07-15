/**
 * Join route has been removed from pi-ultra-messenger.
 * Workers coordinate through MCP Agent Mail, not Pi Messenger channels.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeAction } from '../../router.js';
import type { Dirs, MessengerState } from '../../lib.js';
import { createMockContext } from '../helpers/mock-context.js';

function createDirs(cwd: string): Dirs {
  const base = path.join(cwd, '.pi', 'messenger');
  const registry = path.join(base, 'registry');
  fs.mkdirSync(registry, { recursive: true });
  return { base, registry };
}

function createState(): MessengerState {
  return {
    agentName: 'TestAgent',
    registered: true,
    reservations: [],
    chatHistory: new Map(),
    unreadCounts: new Map(),
    channelPostHistory: [],
    seenSenders: new Map(),
    model: '',
    gitBranch: undefined,
    spec: undefined,
    scopeToFolder: false,
    isHuman: false,
    session: { toolCalls: 0, tokens: 0, filesModified: [] },
    activity: { lastActivityAt: new Date().toISOString() },
    statusMessage: undefined,
    customStatus: false,
    registryFlushTimer: null,
    sessionStartedAt: new Date().toISOString(),
    currentChannel: '',
    sessionChannel: '',
    joinedChannels: [],
  } as MessengerState;
}

describe('router rejects removed join route', () => {
  it('rejects join as removed', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultra-messenger-join-'));
    const dirs = createDirs(cwd);
    const state = createState();

    const res = await executeAction(
      'join',
      { channel: 'dev' },
      state,
      dirs,
      createMockContext(cwd),
      () => {},
      () => {},
      () => {}
    );

    expect(res.content[0]?.text).toContain('Unknown or removed action');
    expect(res.content[0]?.text).toContain('join');

    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
