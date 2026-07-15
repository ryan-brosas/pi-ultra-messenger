#!/usr/bin/env node
/**
 * pi-ultra-messenger — Pi worker pool CLI.
 *
 * Usage:
 *   pi-ultra-messenger status
 *   pi-ultra-messenger list
 *   pi-ultra-messenger swarm
 *   pi-ultra-messenger spawn --role Researcher "Analyze the protocol" [--persona "..."] [--agent-file path] [--objective "..."] [--context "..."] [--message-file <path>]
 *   pi-ultra-messenger spawn list
 *   pi-ultra-messenger spawn history
 *   pi-ultra-messenger spawn stop <id>
 *   pi-ultra-messenger --status
 *   pi-ultra-messenger --start
 *   pi-ultra-messenger --stop
 *   pi-ultra-messenger --restart
 *   pi-ultra-messenger --logs
 *
 * Also accepts JSON for programmatic use:
 *   pi-ultra-messenger '{ "action": "spawn", "role": "Researcher", "message": "Analyze X" }'
 *
 * Coordination surfaces (task/feed/send/reserve/release/channels/join/whois/rename/set_status)
 * have been removed. Workers coordinate through MCP Agent Mail and follow the target
 * project's AGENTS.md directly.
 *
 * Agent identity is resolved automatically from the process tree —
 * no environment variables required. The CLI finds its parent pi process
 * and sends the PID to the harness server, which matches it against
 * registrations on disk.
 */

import { execSync, spawn as spawnChild } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PI_MESSENGER_PORT ?? 9877);
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const LOG = process.env.PI_MESSENGER_LOG ?? '/tmp/pi-messenger-swarm.log';
const SERVER_SCRIPT = path.resolve(__dirname, 'server.js');
const CLI_VERSION: string = (() => {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') });
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: 'timeout' });
    });
  });
}

function httpPost(
  url: string,
  body: string,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const data = Buffer.from(body, 'utf-8');
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': data.length,
          ...extraHeaders,
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') });
        });
      }
    );
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: 'timeout' });
    });
    req.write(data);
    req.end();
  });
}

/**
 * Walk the process tree to find the parent "pi" process PID.
 *
 * When the CLI runs inside a pi bash session, the ancestry looks like:
 *   zsh → pi (PID N) → bash -c "pi-messenger-swarm ..." → node (CLI)
 *
 * The wrapper script (`exec node ...`) replaces bash, so process.ppid
 * is typically the pi PID directly.  As a fallback, we walk up a few
 * levels using `ps` to find a process named "pi".
 *
 * Returns undefined when not running inside pi (human terminal, CI, etc.).
 */
function findCallerPid(): number | undefined {
  try {
    // Fast path: direct parent is pi (wrapper replaces bash via exec)
    const ppid = process.ppid;
    const cmd = execSync(`ps -o comm= -p ${ppid}`, { encoding: 'utf-8', timeout: 1000 }).trim();
    if (cmd === 'pi') return ppid;

    // Walk up a few more levels
    let pid = ppid;
    for (let i = 0; i < 5; i++) {
      const ppidStr = execSync(`ps -o ppid= -p ${pid}`, {
        encoding: 'utf-8',
        timeout: 1000,
      }).trim();
      const nextPid = parseInt(ppidStr, 10);
      if (isNaN(nextPid) || nextPid <= 1) break;
      const nextCmd = execSync(`ps -o comm= -p ${nextPid}`, {
        encoding: 'utf-8',
        timeout: 1000,
      }).trim();
      if (nextCmd === 'pi') return nextPid;
      pid = nextPid;
    }
  } catch {
    // ps unavailable (unlikely on macOS/Linux)
  }
  return undefined;
}

/**
 * Read the agent name from the registration file that matches the
 * caller's PID. This covers the coordinator (main pi session) which
 * doesn't have PI_AGENT_NAME in its env but IS registered with the
 * harness server.
 *
 * The harness server writes one JSON file per registered agent in
 * .pi/messenger/registry/<name>.json. Each file contains { name, pid }.
 * We read all files and match by PID from findCallerPid().
 *
 * Returns undefined if no match found (agent not registered yet, or
 * running outside pi).
 */
function readRegistrationName(): string | undefined {
  try {
    const projectRoot = resolveProjectRoot(process.cwd());
    const registryDir = path.join(projectRoot, '.pi', 'messenger', 'registry');
    if (!fs.existsSync(registryDir)) return undefined;

    const callerPid = findCallerPid();

    // Read all registration files
    const files = fs.readdirSync(registryDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return undefined;

    // If only one registration (common for coordinator), just use it
    if (files.length === 1) {
      const reg = JSON.parse(fs.readFileSync(path.join(registryDir, files[0]), 'utf-8'));
      return reg.name || undefined;
    }

    // Multiple registrations: match by PID
    if (callerPid) {
      for (const file of files) {
        try {
          const reg = JSON.parse(fs.readFileSync(path.join(registryDir, file), 'utf-8'));
          if (reg.pid === callerPid) return reg.name;
        } catch {
          // Skip malformed
        }
      }
    }

    // Fallback: most recently modified registration (most likely active)
    let bestName: string | undefined;
    let bestMtime = 0;
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(registryDir, file));
        if (stat.mtimeMs > bestMtime) {
          bestMtime = stat.mtimeMs;
          bestName = file.replace(/\.json$/, '');
        }
      } catch {
        // Skip
      }
    }
    return bestName;
  } catch {
    return undefined;
  }
}

/**
 * Read the session ID from .pi/messenger/session-id, written by the
 * extension at session_start. This bridges the gap between pi's
 * SessionManager (only available in-process) and the harness server.
 */
function readSessionIdFromFile(): string | undefined {
  try {
    const projectRoot = resolveProjectRoot(process.cwd());
    const sessionFilePath = path.join(projectRoot, '.pi', 'messenger', 'session-id');
    if (fs.existsSync(sessionFilePath)) {
      const id = fs.readFileSync(sessionFilePath, 'utf-8').trim();
      if (id) return id;
    }
  } catch {
    // Not available
  }
  return undefined;
}

function agentHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  // Identity resolution strategy (in priority order):
  // 1. Explicit env var (PI_AGENT_NAME) — set by parent on spawn for subagents
  // 2. Registration name from .pi/messenger/registry/ — the harness server wrote
  //    it during the agent's join. This covers the coordinator (main pi session)
  //    which doesn't have PI_AGENT_NAME in its env but IS registered.
  // 3. PID-based fallback — fragile, races with process exit, last resort.
  const envName = process.env.PI_AGENT_NAME?.trim();
  if (envName) {
    headers['x-agent-name'] = envName;
  } else {
    const regName = readRegistrationName();
    if (regName) headers['x-agent-name'] = regName;
  }

  // PID-based identity as fallback (for pi sessions that don't set PI_AGENT_NAME)
  const callerPid = findCallerPid();
  if (callerPid) headers['x-caller-pid'] = String(callerPid);

  const sessionId = readSessionIdFromFile();
  if (sessionId) headers['x-session-id'] = sessionId;

  // Send the project root (not the raw cwd) so the harness server
  // resolves dirs consistently regardless of which subdirectory
  // the CLI was invoked from.
  headers['x-caller-cwd'] = resolveProjectRoot(process.cwd());

  // Forward PI_MESSENGER_CHANNEL as a request header so that spawned
  // subagents (which inherit this env var from their parent) can join
  // the parent's channel. The harness server only uses this hint when
  // the agent is not yet registered — it does NOT override the channel
  // for already-registered agents.
  if (process.env.PI_MESSENGER_CHANNEL)
    headers['x-messenger-channel'] = process.env.PI_MESSENGER_CHANNEL;
  return headers;
}

async function isUp(): Promise<boolean> {
  const { status } = await httpGet(`${BASE_URL}/health`);
  return status === 200;
}

/**
 * Resolve the project root directory by walking up from `start` to find the
 * nearest ancestor containing `.git/` or `.pi/`. Falls back to `start` itself.
 *
 * This ensures the harness server always uses the project's root
 * `.pi/messenger/` directory, regardless of which subdirectory
 * (e.g., dist/) the CLI was invoked from.
 */
function resolveProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.pi'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

async function startServer(): Promise<boolean> {
  if (await isUp()) return true;

  let serverScript = SERVER_SCRIPT;
  if (!fs.existsSync(serverScript)) {
    const tsPath = path.resolve(__dirname, '..', 'harness', 'server.ts');
    if (fs.existsSync(tsPath)) serverScript = tsPath;
  }

  const useTsx = serverScript.endsWith('.ts');
  const cmd = useTsx ? 'npx' : 'node';
  const args = useTsx ? ['tsx', serverScript] : [serverScript];

  // PI_MESSENGER_CHANNEL must NOT be forwarded to the harness server.
  // It is a per-request hint (sent via x-messenger-channel header) that
  // tells a child process which channel to join. The harness is a
  // long-lived shared daemon — baking this env var into its process
  // environment makes every subsequent request resolve to that channel,
  // regardless of which agent actually issued the request.
  //
  // Similarly, always explicitly set PI_MESSENGER_CWD and PI_MESSENGER_DIR
  // to the project root (the nearest .git/ or .pi/ ancestor). Without this,
  // if the CLI runs from a subdirectory like dist/, the harness server would
  // use dist/.pi/messenger/ instead of the project's root .pi/messenger/.
  const projectRoot = resolveProjectRoot(process.cwd());
  const projectMessengerDir = path.join(projectRoot, '.pi', 'messenger');

  const env: Record<string, string> = {};
  for (const key of ['PI_MESSENGER_GLOBAL'] as const) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  // Always override: pin to project root, not the CLI's cwd
  env.PI_MESSENGER_CWD = projectRoot;
  env.PI_MESSENGER_DIR = projectMessengerDir;
  // Explicit env vars take precedence if set (e.g., by the extension)
  if (process.env.PI_MESSENGER_DIR) env.PI_MESSENGER_DIR = process.env.PI_MESSENGER_DIR;
  if (process.env.PI_MESSENGER_CWD) env.PI_MESSENGER_CWD = process.env.PI_MESSENGER_CWD;

  // Build the server's environment: start from process.env but strip
  // PI_MESSENGER_CHANNEL — it is a per-request hint for spawned subagents,
  // not a property the harness server should ever see. If the CLI was
  // invoked with PI_MESSENGER_CHANNEL in its env (e.g., by a parent agent's
  // spawn), spreading process.env would leak it into the server.
  const { PI_MESSENGER_CHANNEL: _strip, ...serverEnv } = process.env as Record<
    string,
    string | undefined
  >;
  const child = spawnChild(cmd, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
    env: { ...serverEnv, ...env, PI_MESSENGER_PORT: String(PORT), PI_MESSENGER_LOG: LOG },
  });
  child.unref();

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await isUp()) return true;
  }

  process.stderr.write(`pi-messenger-swarm: server failed to start on ${BASE_URL} (see ${LOG})\n`);
  return false;
}

async function postAction(jsonBody: string): Promise<void> {
  const { status, body } = await httpPost(`${BASE_URL}/action`, jsonBody, agentHeaders());
  if (status === 200) {
    try {
      const parsed = JSON.parse(body);
      if (parsed.ok && parsed.result?.text) {
        process.stdout.write(parsed.result.text + '\n');
      } else if (!parsed.ok) {
        process.stderr.write(`Error: ${parsed.error}\n`);
        process.exit(1);
      }
    } catch {
      if (body.trim()) process.stdout.write(body + '\n');
    }
  } else if (status === 0) {
    process.stderr.write(`Error: cannot reach harness server at ${BASE_URL}\n`);
    process.exit(1);
  } else {
    try {
      const parsed = JSON.parse(body);
      process.stderr.write(`Error: ${parsed.error ?? body}\n`);
    } catch {
      process.stderr.write(`Error: HTTP ${status} — ${body}\n`);
    }
    process.exit(1);
  }
}

/** Build the action JSON from parsed subcommand args */
function buildAction(params: Record<string, unknown>): string {
  return JSON.stringify(params);
}

function parseFlag(args: string[], name: string): string | undefined {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx !== -1 && idx + 1 < args.length) {
    args.splice(idx, 2);
    return args.splice(idx - 1, 1)[0]; // already removed by splice above, need to re-read
  }
  return undefined;
}

function extractFlag(args: string[], name: string): string | undefined {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx !== -1 && idx + 1 < args.length) {
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val;
  }
  return undefined;
}

function extractFlagBool(args: string[], name: string): boolean {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx !== -1) {
    args.splice(idx, 1);
    return true;
  }
  return false;
}

function positional(args: string[], index: number): string | undefined {
  // Filter out flags first, return the Nth positional
  const positional = args.filter((a) => !a.startsWith('--'));
  return positional[index];
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0) {
    process.stderr.write('pi-messenger-swarm: no command provided. Use --help for usage.\n');
    process.exit(1);
  }

  const first = rawArgs[0];

  // --- Meta commands (no server needed for --help) ---
  if (first === '--help' || first === '-h') {
    process.stdout.write(`pi-ultra-messenger — Pi worker pool CLI

Usage:
  pi-ultra-messenger status
  pi-ultra-messenger list
  pi-ultra-messenger swarm

  pi-ultra-messenger spawn --role Researcher "Analyze X" [--persona "..."] [--name <name>] [--agent-file <path>] [--objective "..."] [--context "..."] [--message-file <path>] [--model <provider/model>]
  pi-ultra-messenger spawn list
  pi-ultra-messenger spawn history
  pi-ultra-messenger spawn stop <id>

  pi-ultra-messenger --status    Check if harness server is running
  pi-ultra-messenger --start     Start the harness server
  pi-ultra-messenger --stop      Stop the harness server
  pi-ultra-messenger --restart   Restart the harness server
  pi-ultra-messenger --logs      Tail the server log

Also accepts JSON for programmatic use:
  pi-ultra-messenger '{ "action": "spawn", "role": "Researcher", "message": "Analyze X" }'

Environment:
  PI_MESSENGER_PORT     Server port (default: 9877)
  PI_MESSENGER_LOG      Log file (default: /tmp/pi-messenger-swarm.log)
  PI_MESSENGER_DIR      Data directory (project-scoped by default)
  PI_MESSENGER_GLOBAL   Use global data directory if set
`);
    return;
  }

  // --- Server management commands ---
  if (first === '--status') {
    const { status, body } = await httpGet(`${BASE_URL}/health`);
    process.stdout.write(status === 200 ? body + '\n' : '{"ok":false,"error":"down"}\n');
    process.exit(status === 200 ? 0 : 1);
  }

  if (first === '--start') {
    await startServer();
    const { body } = await httpGet(`${BASE_URL}/health`);
    process.stdout.write(body + '\n');
    return;
  }

  if (first === '--stop') {
    if (await isUp()) {
      await httpPost(`${BASE_URL}/quit`, '');
      process.stdout.write('{"ok":true,"stopped":true}\n');
    } else {
      process.stdout.write('{"ok":true,"stopped":false,"note":"already down"}\n');
    }
    return;
  }

  if (first === '--restart') {
    if (await isUp()) {
      // Soft restart: clear config/dir caches in the running server
      // without killing spawned agents. Falls back to full restart
      // if the server doesn't support the /restart endpoint.
      const { status } = await httpPost(`${BASE_URL}/restart`, '');
      if (status === 200) {
        const { body } = await httpGet(`${BASE_URL}/health`);
        process.stdout.write(body + '\n');
        return;
      }
      // Fallback: full stop + start if soft restart not available.
      // Use x-preserve-spawns so running agents survive the restart.
      await httpPost(`${BASE_URL}/quit`, '', { 'x-preserve-spawns': '1' });
      await new Promise((r) => setTimeout(r, 200));
    }
    await startServer();
    const { body } = await httpGet(`${BASE_URL}/health`);
    process.stdout.write(body + '\n');
    return;
  }

  if (first === '--logs') {
    const { spawn } = await import('node:child_process');
    spawn('tail', ['-f', LOG], { stdio: 'inherit' });
    return;
  }

  // --- JSON passthrough ---
  // If the first arg looks like a JSON object, pass it through directly
  if (first.startsWith('{')) {
    if (!(await startServer())) process.exit(1);
    await postAction(first);
    return;
  }

  // --- Natural subcommands ---
  if (!(await startServer())) process.exit(1);

  // Auto-restart the server if its version doesn't match the CLI's.
  // A stale server silently breaks identity resolution, session handling,
  // and other fixes. The server is a long-lived daemon that survives
  // pi session exits (detached + unref'd), so it can accumulate staleness
  // across multiple sessions.
  //
  // IMPORTANT: The restart uses x-preserve-spawns so the old server
  // persists running spawn state to disk and exits WITHOUT killing
  // spawned agent processes. The new server restores the runtimes and
  // reconnects to the surviving agents.
  try {
    const { body } = await httpGet(`${BASE_URL}/health`);
    const health = JSON.parse(body);
    if (health.version && health.version !== CLI_VERSION) {
      process.stderr.write(
        `Server version mismatch (server=${health.version}, cli=${CLI_VERSION}). Restarting with spawn preservation...\n`
      );
      // Tell the old server to quit but preserve spawned agents
      try {
        await httpPost(`${BASE_URL}/quit`, '', { 'x-preserve-spawns': '1' });
      } catch {
        // Server may already be gone
      }
      // Wait for the old server to release the port
      await new Promise((r) => setTimeout(r, 500));
      // Spawn a fresh one
      if (!(await startServer())) {
        process.stderr.write(`Failed to restart server after version mismatch.\n`);
        process.exit(1);
      }
    }
  } catch {
    // Health check failed — server might not be up yet, startServer handles it
  }

  const args = [...rawArgs]; // mutable copy
  const action = args.shift()!;

  switch (action) {
    case 'status': {
      await postAction(buildAction({ action: 'status' }));
      break;
    }
    case 'list': {
      await postAction(buildAction({ action: 'list' }));
      break;
    }
    case 'swarm': {
      await postAction(buildAction({ action: 'swarm' }));
      break;
    }

    // ---- Spawn ----
    case 'spawn': {
      const sub = args[0];
      if (sub === 'list') {
        await postAction(buildAction({ action: 'spawn.list' }));
      } else if (sub === 'history') {
        await postAction(buildAction({ action: 'spawn.history' }));
      } else if (sub === 'stop') {
        const id = args[1];
        if (!id) {
          process.stderr.write('Error: spawn stop requires an id.\n');
          process.exit(1);
        }
        await postAction(buildAction({ action: 'spawn.stop', id }));
      } else {
        // spawn --role Role "mission text" [--persona "..."] [--name name]
        //      [--agent-file path] [--objective "..."] [--context "..."] [--message-file path]
        //      [--model provider/model]
        const role = extractFlag(args, 'role') || extractFlag(args, 'title');
        const persona = extractFlag(args, 'persona');
        const name = extractFlag(args, 'name');
        const agentFile = extractFlag(args, 'agent-file');
        const objective = extractFlag(args, 'objective');
        const context = extractFlag(args, 'context');
        const messageFile = extractFlag(args, 'message-file');
        const model = extractFlag(args, 'model');

        // --message-file takes priority: read mission text from a file to avoid
        // shell interpolation of backticks, ${...}, and parentheses in the prompt.
        let message: string | undefined;
        if (messageFile) {
          try {
            message = fs.readFileSync(messageFile, 'utf-8').trim();
          } catch (err) {
            process.stderr.write(
              `Error: cannot read --message-file: ${messageFile}: ${err instanceof Error ? err.message : err}\n`
            );
            process.exit(1);
          }
        } else {
          message = args.filter((a) => !a.startsWith('--')).join(' ');
        }
        if (!message && !agentFile) {
          process.stderr.write(
            'Error: spawn requires mission text, --message-file, or --agent-file.\n'
          );
          process.exit(1);
        }
        await postAction(
          buildAction({
            action: 'spawn',
            role: role || undefined,
            persona: persona || undefined,
            name: name || undefined,
            agentFile: agentFile || undefined,
            messageFile: messageFile || undefined,
            objective: objective || undefined,
            context: context || undefined,
            message: message || undefined,
            model: model || undefined,
          })
        );
      }
      break;
    }

    default: {
      process.stderr.write(
        `Unknown command: ${action}. Use --help for usage.\n` +
          'Removed commands: join, feed, send, reserve, release, channels, whois, set-status, rename, task.\n'
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`pi-ultra-messenger: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
