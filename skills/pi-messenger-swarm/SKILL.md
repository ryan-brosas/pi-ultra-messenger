---
name: pi-ultra-messenger
description: Pi worker pool. Run spawn/list/status via the `pi-ultra-messenger` CLI — a persistent harness server handles process management. Workers coordinate through MCP Agent Mail and the target project's AGENTS.md.
---

# Pi Ultra Messenger Skill

Pi worker pool via the `pi-ultra-messenger` CLI.

The CLI auto-spawns a long-lived HTTP server (the **harness**) on first use. Every call dispatches an action to the harness, which holds persistent state — agent registrations, spawn history — across calls.

## Setup

If installed globally, the `pi-ultra-messenger` command is on your PATH. Otherwise, the extension installs a shell wrapper script at `~/.pi/agent/bin/pi-messenger-swarm` which pi adds to PATH automatically.

## Commands

```bash
pi-ultra-messenger status          # Show agent status
pi-ultra-messenger list             # List registered agents
pi-ultra-messenger swarm            # Show swarm board summary

pi-ultra-messenger spawn --role Researcher "Analyze X"
pi-ultra-messenger spawn --agent-file agents/researcher.md "Analyze the codebase"
pi-ultra-messenger spawn list
pi-ultra-messenger spawn history
pi-ultra-messenger spawn stop <id>

pi-ultra-messenger --status        # Check if harness server is running
pi-ultra-messenger --start         # Start the harness server
pi-ultra-messenger --stop          # Stop the harness server
pi-ultra-messenger --restart       # Soft restart (preserve workers)
pi-ultra-messenger --logs          # Tail the server log
```

### JSON passthrough

```bash
pi-ultra-messenger '{ "action": "spawn", "role": "Researcher", "message": "Analyze X" }'
```

### Agent file format

`--agent-file` points to a markdown file with optional YAML frontmatter. The frontmatter supplies role/persona/model/objective defaults; the body after `---` becomes the system prompt.

## Removed coordination surfaces

The following Pi Messenger commands have been removed. Workers coordinate through MCP Agent Mail and follow the target project's AGENTS.md directly:

- `join`, `feed`, `send`, `channels` — messaging removed
- `task` (all subcommands) — internal task board removed
- `reserve`, `release` — Pi Messenger reservations removed
- `whois`, `set-status`, `rename` — agent profile management removed

## Worker operating protocol

Workers spawned by this harness follow this protocol:

1. Read AGENTS.md and README.md in the project root first
2. Register with MCP Agent Mail using PI_AGENT_NAME
3. Reserve files via Agent Mail (advisory)
4. Implement the assigned work following AGENTS.md
5. Commit and push following AGENTS.md Git rules
6. Release reservations and exit

## Server management

| Command | Behavior |
|---------|----------|
| `pi-ultra-messenger --status` | Print health JSON or exit 1 |
| `pi-ultra-messenger --start` | Start the harness server |
| `pi-ultra-messenger --stop` | Graceful shutdown |
| `pi-ultra-messenger --restart` | Soft restart: clear caches, preserve workers |
| `pi-ultra-messenger --logs` | `tail -f` the server log |

## Storage layout

```
.pi/messenger/
├── agents/               # Spawn event JSONL (per session)
│   └── <session>.jsonl
└── registry/             # Agent registration files
```
