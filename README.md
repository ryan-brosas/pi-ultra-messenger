# pi-ultra-messenger

**Continuous Pi worker pool for the Agent Flywheel workflow**

A fork of [`pi-messenger-swarm`](https://github.com/monotykamary/pi-messenger-swarm) by [Tom X Nguyen (@monotykamary)](https://github.com/monotykamary), customized into a continuous Pi worker pool.
Configure Pi-visible worker pools, start the supervisor, and it continuously
replenishes lightweight Pi agents that execute the existing Agent Flywheel
workflow — without manually farming terminal panes.

## Quick Start

```bash
# Install
pi install npm:pi-ultra-messenger

# Non-interactive setup with two pools
pi-ultra-messenger setup \
  --worker 'anthropic/claude-sonnet-5=6' \
  --worker 'umans/umans-coder=4' \
  --max-concurrent 10 \
  --start

# Or interactive
pi-ultra-messenger setup

# Start the supervisor
pi-ultra-messenger supervisor start

# Check status
pi-ultra-messenger supervisor status

# Open the /swarm overlay in Pi
/swarm
```

## Commands

```bash
# Setup
pi-ultra-messenger setup [--worker 'model=count'] [--max-concurrent n] [--start] [--dry-run]

# Pool management
pi-ultra-messenger pool list
pi-ultra-messenger pool add --model <provider/model> --workers <n>
pi-ultra-messenger pool remove <id>
pi-ultra-messenger pool scale <id> --workers <n>
pi-ultra-messenger pool enable <id>
pi-ultra-messenger pool disable <id>

# Supervisor
pi-ultra-messenger supervisor start
pi-ultra-messenger supervisor status
pi-ultra-messenger supervisor pause
pi-ultra-messenger supervisor resume
pi-ultra-messenger supervisor stop

# Spawn (manual)
pi-ultra-messenger spawn --role Researcher "Analyze X" [--model provider/model]
pi-ultra-messenger spawn list
pi-ultra-messenger spawn history
pi-ultra-messenger spawn stop <id>

# Worker telemetry (called by spawned workers)
pi-ultra-messenger worker status --phase <phase> [--bead <id>] [--spawn-id <id>] [--agent-name <name>] "message"

# Status
pi-ultra-messenger status
pi-ultra-messenger list
pi-ultra-messenger swarm

# Server
pi-ultra-messenger --status | --start | --stop | --restart | --logs
```

## Architecture

```text
Project checkout on main
  AGENTS.md · .beads/ · source · .pi/pi-messenger.json
        ↓
Detached harness server
  Supervisor timer (poll, refill, stagger)
  Spawn map (PIDs, progress, history)
  JSONL events + spawn-runtimes.json + orphan recovery
        ↓ spawn Pi JSON workers
Fungible Pi workers
  Pi loads AGENTS.md
  Worker uses br / bv / MCP Agent Mail / Git / project tools
  Worker completes one bead and exits
```

## What This Fork Keeps

- Detached harness process
- Pi JSON-mode spawning
- Role-file loading
- Pi skill discovery
- Live JSON event parsing
- Per-project spawned-agent JSONL history
- PID persistence
- Harness restart recovery
- Orphan-process reconciliation
- Concurrency limiting
- Memorable worker names
- Pi extension and terminal overlay framework

## What This Fork Removes

- Pi Messenger channels and direct messages
- Pi Messenger feed polling
- Pi Messenger file reservations
- Custom task.\* issue database
- Internal task board
- Task claims and completion through Pi Messenger

Workers coordinate through MCP Agent Mail and follow the target project's
AGENTS.md directly.

## Optional Roles

- **Coordinator** (`agents/coordinator.md`): one-shot tender that inspects
  worker state and sends coordination messages via Agent Mail. Disabled by
  default. Never gates refill.
- **Goal Refiner** (`agents/goal-refiner.md`): suggestion-only role that
  posts refinement comments on ready work. Disabled by default. Never
  gates refill.

## Configuration

```json
{
  "maxConcurrentSpawns": 10,
  "supervisor": {
    "enabled": true,
    "paused": false,
    "pollIntervalMs": 15000,
    "maxStartsPerTick": 2,
    "workerPools": [
      { "id": "default", "workers": 3, "model": { "mode": "inherit" }, "enabled": true }
    ],
    "coordinator": { "enabled": false, "model": { "mode": "inherit" }, "mode": "manual" },
    "goalRefiner": { "enabled": false, "model": { "mode": "inherit" }, "mode": "manual" }
  }
}
```

Config locations: `.pi/pi-messenger.json` (project), `~/.pi/agent/pi-messenger.json` (global).

## License

MIT
