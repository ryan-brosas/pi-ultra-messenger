# PLAN: Fork `pi-messenger-swarm` into a Continuous Pi Worker Pool for the Agent Flywheel

**Plan version:** 12.0 — proven-path implementation blueprint  
**Last updated:** 2026-07-15  
**Status:** ready for Bead conversion after the Phase 0 local contract capture  
**Fork base:** `monotykamary/pi-messenger-swarm@1b17674150b6b3a13f287be0660cf0382e8c5656`  
**Fork-base package version:** `0.25.22`  
**Primary coding runtime:** Pi only  
**Work authority:** Beads Rust (`br`)  
**Work-ranking sidecar:** Beads Viewer (`bv --robot-*`)  
**Agent coordination:** the user's installed MCP Agent Mail  
**Operating contract:** the target project's `AGENTS.md`  
**Source-work model:** one shared checkout on `main`, matching the selected Agent Flywheel workflow  
**Model authority:** the current Pi user's authenticated and configured model inventory  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Grounding Rules and Evidence Ledger](#2-grounding-rules-and-evidence-ledger)
3. [Background: What Exists Today](#3-background-what-exists-today)
4. [Problem Statement](#4-problem-statement)
5. [Goals, Non-Goals, and Success Metrics](#5-goals-non-goals-and-success-metrics)
6. [Owner-Approved Product Decisions](#6-owner-approved-product-decisions)
7. [Target User Experience](#7-target-user-experience)
8. [Target Architecture](#8-target-architecture)
9. [Configuration and Pi-Native Model Pools](#9-configuration-and-pi-native-model-pools)
10. [Setup and Model Discovery](#10-setup-and-model-discovery)
11. [Continuous Supervisor Loop](#11-continuous-supervisor-loop)
12. [Worker Self-Selection and Ready-Work Capacity](#12-worker-self-selection-and-ready-work-capacity)
13. [Pi Worker Launch and Session Behavior](#13-pi-worker-launch-and-session-behavior)
14. [`AGENTS.md` and the ACFS Operating Contract](#14-agentsmd-and-the-acfs-operating-contract)
15. [Direct `br`, `bv`, and Agent Mail Workflow](#15-direct-br-bv-and-agent-mail-workflow)
16. [Shared-`main` Git Workflow](#16-shared-main-git-workflow)
17. [Worker Telemetry and Runtime Records](#17-worker-telemetry-and-runtime-records)
18. [Durability and Recovery](#18-durability-and-recovery)
19. [Optional Coordinator Tender](#19-optional-coordinator-tender)
20. [Optional Bead Enricher](#20-optional-bead-enricher)
21. [CLI Design](#21-cli-design)
22. [Operator Overlay and UI/UX](#22-operator-overlay-and-uiux)
23. [Detailed File-by-File Implementation Plan](#23-detailed-file-by-file-implementation-plan)
24. [Testing Strategy](#24-testing-strategy)
25. [Implementation Phases](#25-implementation-phases)
26. [Release Gates and Acceptance Criteria](#26-release-gates-and-acceptance-criteria)
27. [Risk Analysis](#27-risk-analysis)
28. [Phase 0 Local Contract Capture](#28-phase-0-local-contract-capture)
29. [Post-V1 Roadmap](#29-post-v1-roadmap)
30. [Appendix A: Complete CLI Grammar](#appendix-a-complete-cli-grammar)
31. [Appendix B: Complete Configuration Example](#appendix-b-complete-configuration-example)
32. [Appendix C: Shipped Role Files](#appendix-c-shipped-role-files)
33. [Appendix D: Runtime State and Refill State Machines](#appendix-d-runtime-state-and-refill-state-machines)
34. [Appendix E: Source-to-Target File Map](#appendix-e-source-to-target-file-map)
35. [Appendix F: Final Release Checklist](#appendix-f-final-release-checklist)

---

# 1. Executive Summary

This plan customizes the existing `pi-messenger-swarm` repository into a **continuous Pi worker pool for the Agent Flywheel workflow**.

The fork does not redesign the Flywheel. It automates the part currently performed by NTM, tmux panes, or repeated manual `pi` launches:

```text
configure Pi-visible worker pools
        ↓
start one detached harness
        ↓
keep the requested number of lightweight Pi workers busy
        ↓
let every worker follow the project's existing AGENTS.md workflow
        ↓
replace exited workers while ready Beads remain
        ↓
show the operator what is running, which model is in use, and what needs attention
```

The existing ACFS/Flywheel authorities remain unchanged:

```text
AGENTS.md
  project rules, safety discipline, build/test commands, DCG/UBS/RCH usage,
  Git conventions, and completion expectations

br
  issue lifecycle, dependencies, status, assignment, comments, and closure

bv --robot-*
  graph analysis, triage, priority, parallel tracks, bottlenecks, and next-work advice

MCP Agent Mail
  agent identity, inbox/outbox, Bead threads, acknowledgments, and advisory reservations

Git
  shared-main source history, commits, and pushes

Pi
  authenticated models, context files, tools, sessions, skills, and inference

this fork
  setup, model-backed pool counts, Pi spawning, process monitoring, refill,
  runtime history, operator controls, and a worker-focused overlay
```

The fork keeps proven upstream machinery:

- the detached harness process;
- Pi JSON-mode spawning;
- role-file loading;
- Pi skill discovery;
- live JSON event parsing;
- per-project spawned-agent JSONL history;
- PID persistence;
- harness restart recovery;
- orphan-process reconciliation;
- concurrency limiting;
- memorable worker names;
- the Pi extension and terminal overlay framework.

The fork removes or disables product surfaces that duplicate the user's existing stack:

- Pi Messenger channels and direct messages;
- Pi Messenger feed polling;
- Pi Messenger file reservations;
- the custom `task.*` issue database;
- the internal task board;
- task claims and task completion through Pi Messenger.

Workers remain **fungible, one-Bead agents**. A worker is launched, reads the project rules, registers with Agent Mail, claims one Bead through `br`, coordinates and reserves files, implements and tests, follows the repository's Git and completion rules, then exits. The supervisor replenishes the pool.

The plan deliberately does **not** add a new database, task engine, mailbox, reservation engine, Git merge queue, sandbox, or distributed scheduler. The runtime state continues to use the repository's existing event files and spawn-runtime recovery path.

The final product promise is:

> Configure one or more Pi-visible worker pools, start the supervisor, and let it continuously replenish lightweight Pi agents that execute the existing Agent Flywheel workflow—without manually farming terminal panes.

---

# 2. Grounding Rules and Evidence Ledger

## 2.1 Evidence classes

This plan uses three classes:

| Class | Meaning |
|---|---|
| **VERIFIED BASELINE** | Behavior demonstrated by the pinned fork or official current documentation. |
| **OWNER DECISION** | A product choice explicitly made during this planning conversation. |
| **IMPLEMENTATION CHANGE** | A direct, bounded modification to the pinned fork using an already-supported extension point or command. |

A fourth label is reserved for local installation facts:

| Class | Meaning |
|---|---|
| **LOCAL PROBE** | A value or capability that must be read from the user's installed Pi/ACFS environment rather than guessed. |

## 2.2 No-invented-subsystem rule

The V1 plan must not introduce any of the following:

```text
new task database
new message database
new reservation authority
new generic MCP framework
new transactional control database
new ProjectActor framework
new StartPermit or admission-saga platform
new AttemptRunner executable
new Git landing or merge service
new worktree manager
new filesystem sandbox claim
new multi-host scheduler
new provider credential store
new model registry separate from Pi
```

If a future problem demonstrably requires one of those systems, it belongs in a separate post-V1 plan backed by measurements from the shipped worker pool.

## 2.3 Pinned source ledger

| Subject | Pinned source | Facts used by this plan |
|---|---|---|
| Fork base | `monotykamary/pi-messenger-swarm@1b17674150b6b3a13f287be0660cf0382e8c5656` | Current harness, spawn path, JSONL event files, concurrency guard, role files, progress parser, runtime persistence, orphan recovery, extension, and overlay. |
| Package metadata | fork `package.json`, version `0.25.22` | TypeScript package, one CLI, one Pi extension, Vitest, pnpm, Pi `0.80.6`. |
| Pi | `earendil-works/pi` tag `v0.80.6` | JSON and RPC modes, `AGENTS.md` discovery, project trust, model flags, `--list-models`, sessions, `--name`, `--session-dir`, and tool filtering. |
| Beads Rust | `Dicklesworthstone/beads_rust@ab0288cba1745427bf5ac37cafee8d19fdfcd423` | `br ready --json`, `br update --claim`, status/assignee updates, comments, dependencies, closure, lint, coordination status, and JSONL sync. |
| Beads Viewer | `Dicklesworthstone/beads_viewer@b6d6bf2afd292674999c982dd818efdbbb158501` | `bv --robot-triage`, `--robot-next`, `--robot-plan`, and agent-safe output conventions. |
| Agent Mail | `Dicklesworthstone/mcp_agent_mail@35e774fa9ae636c6e1662ab7925d7e68938bb718` | Agent identity, inboxes, messages, threads, reservations, reservation renewal/release, resources, and pre-commit guard. |
| Methodology | `https://agent-flywheel.com/complete-guide` reviewed 2026-07-15 | Same-codebase agents, direct `main`, AGENTS.md-first startup, Agent Mail coordination, `br` claims, `bv` routing, advisory reservations, DCG, UBS, and repeated worker tending. |
| Golden exemplar 1 | `PLAN_TO_MAKE_JEFFREYSPROMPTS_WEBAPP_AND_CLI_TOOL.md` | Self-contained background, goals, exact file map, concrete implementation, and success criteria. |
| Golden exemplar 2 | `PLAN_TO_CREATE_GH_PAGES_WEB_EXPORT_APP.md` | Requirements, architecture, UX, implementation phases, safety, risk analysis, and open questions. |

## 2.4 Source links

- Fork base: <https://github.com/monotykamary/pi-messenger-swarm/tree/1b17674150b6b3a13f287be0660cf0382e8c5656>
- Pi `v0.80.6`: <https://github.com/earendil-works/pi/tree/v0.80.6>
- Beads Rust: <https://github.com/Dicklesworthstone/beads_rust/tree/ab0288cba1745427bf5ac37cafee8d19fdfcd423>
- Beads Viewer: <https://github.com/Dicklesworthstone/beads_viewer/tree/b6d6bf2afd292674999c982dd818efdbbb158501>
- MCP Agent Mail: <https://github.com/Dicklesworthstone/mcp_agent_mail/tree/35e774fa9ae636c6e1662ab7925d7e68938bb718>
- Agent Flywheel guide: <https://agent-flywheel.com/complete-guide>
- Golden exemplar 1: <https://github.com/Dicklesworthstone/jeffreysprompts.com/blob/main/PLAN_TO_MAKE_JEFFREYSPROMPTS_WEBAPP_AND_CLI_TOOL.md>
- Golden exemplar 2: <https://github.com/Dicklesworthstone/coding_agent_session_search/blob/main/docs/planning/PLAN_TO_CREATE_GH_PAGES_WEB_EXPORT_APP.md>

## 2.5 Plan preservation

The preceding V11 document is preserved as:

```text
PLAN_TO_FORK_PI_MESSENGER_SWARM_CODE_LEVEL_IMPLEMENTATION_BLUEPRINT_V11_SNAPSHOT.md
```

The V12 document replaces it in place as the current plan.

---

# 3. Background: What Exists Today

## 3.1 Current product

The pinned project is a Pi package that provides:

```text
Pi extension
  ├── agent registration
  ├── channels and feed
  ├── task lifecycle
  ├── reservations
  ├── spawned Pi subagents
  └── /messenger overlay

Detached harness
  ├── HTTP action endpoint on loopback
  ├── per-request project resolution
  ├── shared spawned-process map
  ├── runtime persistence on shutdown
  └── orphan recovery on startup

CLI
  ├── messaging commands
  ├── task commands
  ├── spawn commands
  └── harness lifecycle commands
```

## 3.2 Current Pi spawn path

The current `swarm/spawn.ts` implementation already:

1. creates a generated worker name;
2. builds a role/system prompt;
3. loads optional agent-file frontmatter;
4. supports a model from the agent file;
5. starts Pi in JSON mode;
6. loads the package extension;
7. discovers user and project Pi skills;
8. appends a system-prompt file;
9. parses stdout JSON events;
10. tracks recent tools, token counts, and elapsed time;
11. appends spawn/progress/completion events to JSONL;
12. stores a PID;
13. stops workers with TERM then KILL;
14. persists live runtimes during harness replacement;
15. restores live PIDs after restart;
16. scans the event log for orphaned live workers after a crash.

Current arguments are approximately:

```text
pi
  --mode json
  --no-session
  [--provider PROVIDER --model MODEL]
  --extension <package-extension>
  [--skill PATH ...]
  --append-system-prompt <temporary-role-file>
  <mission prompt>
```

## 3.3 Current durability boundary

The current package already persists:

```text
.pi/messenger/agents/<session-id>.jsonl
  spawn and process outcome history

.pi/messenger/agents/<session-id>/
  generated agent definition files

spawn-runtimes.json
  live PID records for clean harness replacement
```

It also recovers from two cases:

```text
clean harness replacement
  → restore spawn-runtimes.json

harness crash
  → scan agent event logs
  → reattach to entries whose PIDs are still alive
  → mark dead entries failed
```

That is enough for the intended V1 process supervisor. It is not a complete transactional runtime database, and V1 does not claim that it is one.

## 3.4 Current model wiring defect

The public action parameter type already has `model?: string`, and `swarm/spawn.ts` already knows how to convert `provider/model` into Pi arguments.

The missing links are:

```text
harness CLI does not parse --model
SpawnRequest does not contain model
spawn handler does not forward params.model
spawn record uses only agent-file model
```

This is a direct wiring fix, not a new model subsystem.

## 3.5 Current coupling that must be removed

The current generated worker prompt requires:

```text
pi-messenger-swarm join
task claim
task progress
task done
feed polling
Pi Messenger send
Pi Messenger reservations
```

Those instructions conflict with the user's selected Flywheel stack, where:

```text
br owns task state
bv owns task intelligence
Agent Mail owns identity/messages/reservations
AGENTS.md owns the worker operating rules
```

## 3.6 Current limitations accepted by this plan

The pinned runtime has known limits:

- worker stdout/stderr pipes cannot be reattached after the harness process dies;
- restored workers can be monitored by PID, but their live output is unavailable;
- event files are replayed in full;
- malformed event lines are skipped;
- PID liveness does not prove PID identity after reuse;
- the loopback HTTP protocol is local but unauthenticated;
- configuration parsing is permissive;
- the harness is not an OS boot service.

V1 does not redesign all of these. It documents them, tests the selected operating profile, and improves only the parts necessary for continuous Pi worker replenishment.

---

# 4. Problem Statement

The user can already launch Pi agents and choose models, but the agents do not form a convenient continuous worker pool.

Today the operator must repeatedly:

```text
open panes
launch Pi
choose a model
send the kickoff prompt
notice when a worker exits
launch a replacement
remember which model/count each pane should use
inspect several panes to find failures
```

The current `pi-messenger-swarm` spawn command helps with one-shot delegation, but it is still tied to its own task/message/reservation system and has no pool-refill loop.

The desired system should:

1. keep Pi as the only worker runtime;
2. use the user's existing Pi authentication and model inventory;
3. maintain configured worker counts per model;
4. spawn only when ready Beads exist;
5. give every worker the canonical Agent Flywheel kickoff;
6. let workers use `br`, `bv`, Agent Mail, Git, and ACFS tools directly;
7. replace exited workers automatically;
8. preserve existing harness restart recovery;
9. expose useful worker and pool status;
10. avoid duplicating existing ACFS authorities.

---

# 5. Goals, Non-Goals, and Success Metrics

## 5.1 Goals

### Goal A — One-command setup

Support:

```bash
pi-messenger-swarm setup \
  --worker 'provider/model=6' \
  --worker 'umans/glm-5.2=4' \
  --coordinator 'openai-codex/sol' \
  --start
```

The identifiers above are examples supplied by the owner. Setup validates them against the current Pi user's model inventory before saving them.

### Goal B — Continuous system-level work

The system stays productive through worker replacement:

```text
worker starts
  → executes one Bead
  → exits
  → supervisor sees free pool slot and ready work
  → replacement starts
```

A worker is not required to remain alive indefinitely.

### Goal C — Preserve the Flywheel workflow

Workers directly use:

```text
AGENTS.md
br
bv
MCP Agent Mail
Git
project tests
DCG/UBS/RCH and other project tools described in AGENTS.md
```

### Goal D — Pi-native model ownership

The fork never stores API keys or provider credentials. A pool either:

```text
inherits Pi's normal current model
```

or selects an exact model that Pi reports as available.

### Goal E — Practical durability

Use and extend the current proven runtime path:

- detached harness;
- spawn JSONL;
- persisted live PIDs;
- restored/orphaned worker reconciliation;
- saved Pi sessions;
- automatic pool refill after process exit.

### Goal F — Clear operator experience

The user can answer:

```text
Is the supervisor running?
How many workers should exist?
How many are running in each pool?
Which Pi model was requested and actually observed?
Which Bead has a worker successfully claimed?
What is the worker doing now?
Which workers failed or detached?
Why did the supervisor not spawn more workers?
```

## 5.2 Non-goals for V1

V1 does not include:

- a replacement for `br`;
- a replacement for `bv`;
- a replacement for Agent Mail;
- a general MCP client library;
- a custom mailbox or reservation database;
- supervisor-owned Bead claims or closure;
- supervisor-owned Git commits or pushes;
- an automatic merge queue;
- per-Bead worktrees;
- a filesystem sandbox;
- a new transactional runtime database;
- a generic agent-runtime adapter layer;
- a remote or multi-host control plane;
- provider credential management;
- active coordinator control of every dispatch;
- automatic stale-claim reclamation;
- automatic Bead rewriting by the Enricher;
- automatic retries of the same Bead after a failed worker;
- a guarantee against a malicious same-user shell process.

## 5.3 Success metrics

### Functional

- Setup discovers Pi-visible models and writes a valid project configuration.
- A two-pool configuration launches the requested model mix.
- The supervisor never exceeds `maxConcurrentSpawns`.
- When a worker exits and ready work remains, a replacement starts without operator action.
- No worker prompt references Pi Messenger tasks, channels, feed, or reservations.
- Workers read `AGENTS.md` before claiming work.
- `br`, `bv`, and Agent Mail remain the only work/coordination systems used by workers.

### Reliability

- Harness soft restart preserves running workers.
- Harness replacement restores persisted live PIDs.
- Harness crash recovery reattaches live orphaned PIDs from the event log.
- A dead recorded PID is marked failed.
- Supervisor restart reconstructs pool occupancy from existing spawn records.
- A worker failure does not prevent other pools from refilling.

### Performance

- Supervisor idle polling adds negligible CPU use.
- Model inventory is cached for setup and spawn validation rather than launching a probe for every worker.
- Spawn refill is staggered and capped per tick.
- Overlay rendering remains responsive with 50 recent workers and 20 active workers.

### UX

- Bare CLI invocation provides a useful quick start.
- Human output is concise; JSON output is stable.
- Model-unavailable errors name the pool and exact requested model.
- Status explains no-ready-work, capacity-full, paused, model-unavailable, and harness-detached states.

---

# 6. Owner-Approved Product Decisions

## 6.1 Pi only

Pi is the sole coding-agent runtime. No Claude Code, Codex CLI, Antigravity, or generic command adapters are added.

Different providers/models may still be used through Pi's own authentication and model catalog.

## 6.2 Keep the existing ACFS/Flywheel stack

The fork does not absorb ACFS tools. Workers use them normally through `AGENTS.md`.

## 6.3 Remove redundant Pi Messenger coordination

The supported product removes:

```text
send
feed
channels
join-as-a-chat-system
Pi Messenger reserve/release
task.*
internal task board
```

The fork may keep an internal runtime event stream for process telemetry. That stream is not agent messaging.

## 6.4 Shared `main`

Workers operate in the same checkout on `main`, following the selected Agent Flywheel workflow.

Normal workers do not receive branches or worktrees.

## 6.5 Workers follow `AGENTS.md` directly

The supervisor does not reproduce DCG, UBS, RCH, no-script, testing, Git, or safety instructions in TypeScript policy engines.

Every worker receives the project rules through Pi's native context loading and is explicitly told to read the complete root `AGENTS.md` before doing anything else.

## 6.6 One Bead per worker process

Each implementation worker completes, blocks, or safely hands off one Bead, then exits.

Continuous operation is provided by replenishment, not by forcing one model context to run forever.

## 6.7 Model-backed pools

The user may request several pools:

```text
provider/model     6 workers
umans/glm-5.2      4 workers
```

The exact model strings are validated from Pi. The package ships none of those IDs as defaults.

## 6.8 Optional coordinator

The coordinator is a one-shot tender, not a task authority or permanent bottleneck.

It may inspect `br`, `bv`, Agent Mail, worker status, and recent failures, then send useful coordination messages. The worker pool still operates when the coordinator is disabled or unavailable.

## 6.9 Optional Bead Enricher

The Enricher is a separate one-shot Pi role. V1 defaults to suggestion-only. It does not edit source.

## 6.10 Preserve the current package shape

The implementation remains one TypeScript Pi package with one CLI and one Pi extension. It does not become a monorepo or a broad platform rewrite.

---

# 7. Target User Experience

## 7.1 First run

From a project already prepared for the Agent Flywheel:

```bash
cd /path/to/project
pi-messenger-swarm setup
```

The wizard displays:

```text
Project            /path/to/project
AGENTS.md           found
Beads               found / missing
bv                   found / missing
Agent Mail in Pi    verified / not verified
Pi models           14 visible
Current branch      main
Pre-commit guard    detected / unknown
```

The wizard asks:

1. Use Pi's current model for a worker pool, or choose an exact Pi-visible model?
2. How many workers should that pool maintain?
3. Add another pool?
4. What is the global maximum concurrent spawn count?
5. Enable the optional coordinator?
6. Enable the optional Bead Enricher?
7. Start now?

## 7.2 Non-interactive setup

```bash
pi-messenger-swarm setup \
  --worker 'provider/model=6' \
  --worker 'umans/glm-5.2=4' \
  --max-concurrent 10 \
  --coordinator 'openai-codex/sol' \
  --start
```

Use Pi's inherited model:

```bash
pi-messenger-swarm setup \
  --worker 'inherit=4' \
  --start
```

Preview without writing:

```bash
pi-messenger-swarm setup \
  --worker 'inherit=4' \
  --dry-run
```

## 7.3 Starting and stopping

```bash
pi-messenger-swarm supervisor start
pi-messenger-swarm supervisor status
pi-messenger-swarm supervisor pause
pi-messenger-swarm supervisor resume
pi-messenger-swarm supervisor stop
```

Semantics:

```text
start
  begin periodic refill for the current project

pause
  keep existing workers alive; start no replacements

resume
  resume refill

stop
  stop refill; existing workers continue unless explicitly stopped
```

Stopping the supervisor is not a destructive action and does not kill active workers by default.

## 7.4 Normal refill

Assume:

```text
fast pool target       6
second pool target     4
global max            10
ready Beads            4
running workers        3
workers still selecting 1
```

The supervisor starts at most three additional workers. The worker that is still selecting already consumes one unit of the current ready-work demand, so the pool does not start more selectors than the visible ready set can support.

It staggers starts according to `maxStartsPerTick`.

## 7.5 Worker startup

A new worker sees:

```text
Pi system prompt
+ project/user AGENTS.md context loaded by Pi
+ narrow implementer role file
+ first user message containing the one-Bead kickoff instructions
```

The first visible worker actions are:

```text
read AGENTS.md
read README.md
inspect current Git status without disturbing unrelated changes
register/resume Agent Mail identity
check inbox and active agents
use `bv`/`br` to select and claim one ready Bead
reserve exact paths
announce start
```

## 7.6 Worker completion

The worker follows the repository's own `AGENTS.md` completion workflow.

Typically:

```text
implement
run focused checks
run required project checks / UBS / RCH as instructed
self-review
commit/push main as instructed
close/update Bead through br
sync Beads if required
release Agent Mail reservations
post final thread message
report local worker status
exit
```

The supervisor observes the process exit and fills the free pool slot if ready work remains.

## 7.7 Failure

If a worker exits nonzero:

```text
spawn record becomes failed
pool slot becomes free
failure remains visible in history
supervisor may start a fresh generic worker for other ready work
```

The supervisor does not automatically steal or reset the failed worker's Bead.

The operator or optional coordinator checks:

```text
br show
br coordination status
Agent Mail thread
active reservations
Git status
```

and decides whether to reclaim, clarify, or split the Bead.

## 7.8 Operator dashboard

```text
PI WORKER POOL · /path/to/project

SUPERVISOR  RUNNING     READY 7     RUNNING 6/10

POOLS
primary     provider/model       target 6   running 4   free 2
secondary   umans/glm-5.2        target 4   running 2   free 2

WORKERS
BlueLake      primary     br-123     implementing    07:41
QuietRiver    primary     br-129     tests            04:03
CoralBadger   secondary   br-131     claiming         00:36
SilverPine    secondary   —          starting         00:04

ATTENTION
1 failed worker · 1 in-progress Bead has no live worker
```

## 7.9 Optional coordinator run

```bash
pi-messenger-swarm coordinator run
```

The coordinator reads the project rules and current swarm state, then sends targeted Agent Mail messages or reports recommendations. It exits after one pass.

## 7.10 Optional Bead enrichment

```bash
pi-messenger-swarm bead enrich br-123
```

Default output is a structured review printed for operator review. A Bead comment is added only when the operator supplies `--comment`. Source files are not edited.

---

# 8. Target Architecture

## 8.1 Architecture overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         Project checkout on main                     │
│                                                                      │
│  AGENTS.md   .beads/   source   tests   .pi/pi-messenger.json       │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   Existing detached harness server                   │
│                                                                      │
│  ┌────────────────────┐  ┌────────────────────┐                     │
│  │ Supervisor timer   │  │ Existing spawn map │                     │
│  │ - ready count      │  │ - PIDs             │                     │
│  │ - pool deficits    │  │ - progress         │                     │
│  │ - refill           │  │ - history          │                     │
│  └────────────────────┘  └────────────────────┘                     │
│                                                                      │
│  Existing JSONL events + spawn-runtimes.json + orphan recovery      │
└──────────────────────────────────────────────────────────────────────┘
                     │ spawn Pi JSON workers
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Fungible Pi workers                          │
│                                                                      │
│  Pi loads AGENTS.md                                                  │
│  worker uses br / bv / MCP Agent Mail / Git / project tools         │
│  worker completes one Bead and exits                                │
└──────────────────────────────────────────────────────────────────────┘
```

## 8.2 Responsibility split

| Responsibility | Owner |
|---|---|
| Project operating rules | `AGENTS.md` |
| Model authentication and availability | Pi |
| Task readiness, claim, state, dependencies, closure | `br` |
| Graph-aware routing and priority advice | `bv` |
| Agent identity, messages, threads, reservations | MCP Agent Mail |
| Source edits, tests, commits, pushes | Worker, following `AGENTS.md` |
| Process spawn, stop, history, refill, UI | This fork |

## 8.3 Supervisor data flow

```text
timer or worker exit
  → load current project config
  → reconcile current spawned-agent records
  → call br ready --json read-only
  → count live workers that have not yet reported a claimed Bead
  → reserve that many units of the visible ready-work count
  → compute missing slots per pool
  → respect maxConcurrentSpawns and maxStartsPerTick
  → spawn generic one-Bead workers
  → wait for next event/tick
```

## 8.4 Worker data flow

```text
Pi starts in project cwd
  → Pi loads AGENTS.md
  → worker explicitly reads AGENTS.md and README.md
  → worker registers Agent Mail identity
  → worker checks inbox/active agents
  → worker uses bv/br to select and atomically claim one ready Bead
       claim failed → refresh and choose another ready Bead
  → worker reserves exact paths in Agent Mail
  → worker announces work in Bead thread
  → worker implements/tests/reviews
  → worker follows AGENTS.md Git + Beads completion rules
  → worker releases reservations
  → worker exits
```

## 8.5 Why this architecture is intentionally small

The fork base already has process supervision and recovery. The ACFS stack already has task and coordination systems. The implementation therefore adds only:

```text
pool configuration
model discovery
refill timer
ready-work capacity accounting
worker telemetry
new role prompts
worker-focused CLI and overlay
```

Everything else remains in the system that already owns it.

## 8.6 Project scope

V1 supervises the project from which the harness was started or explicitly registered.

The current harness can receive actions from several project working directories, but V1 does not promise durable, reboot-independent restoration of several independently active project supervisors. Multi-project persistent registration is post-V1.

## 8.7 Runtime availability boundary

The harness is a detached user process, not an OS service.

V1 guarantees:

```text
while harness is alive
  periodic refill continues

harness soft restart/replacement
  existing workers survive and are restored

harness crash
  workers may survive; next harness start reconciles live PIDs

machine reboot/logout
  user restarts Pi or the CLI; this is not a boot service
```

---

# 9. Configuration and Pi-Native Model Pools

## 9.1 Preserve the existing configuration file

Continue using:

```text
project:  .pi/pi-messenger.json
global:   ~/.pi/agent/pi-messenger.json
settings: ~/.pi/agent/settings.json → messenger
```

Do not create a second committed policy file for V1.

## 9.2 Extended configuration types

```ts
export type PiModelSelection =
  | { mode: 'inherit' }
  | { mode: 'exact'; model: string };

export interface WorkerPoolConfig {
  id: string;
  workers: number;
  model: PiModelSelection;
  roleFile?: string;
  enabled: boolean;
}

export interface CoordinatorConfig {
  enabled: boolean;
  model: PiModelSelection;
  roleFile?: string;
  mode: 'manual' | 'interval';
  intervalMinutes?: number;
}

export interface BeadEnricherConfig {
  enabled: boolean;
  model: PiModelSelection;
  roleFile?: string;
  mode: 'manual';
}

export interface SupervisorConfig {
  enabled: boolean;
  paused: boolean;
  pollIntervalMs: number;
  maxStartsPerTick: number;
  workerPools: WorkerPoolConfig[];
  coordinator: CoordinatorConfig;
  beadEnricher: BeadEnricherConfig;
}

export interface MessengerConfig {
  // Retained upstream fields required by still-supported runtime behavior.
  autoRegister: boolean;
  autoRegisterPaths: string[];
  scopeToFolder: boolean;
  contextMode: 'full' | 'minimal' | 'none';
  registrationContext: boolean;
  replyHint: boolean;
  senderDetailsOnFirstContact: boolean;
  nameTheme: string;
  nameWords?: { adjectives: string[]; nouns: string[] };
  feedRetention: number;
  stuckThreshold: number;
  stuckNotify: boolean;
  autoStatus: boolean;
  autoOverlay: boolean;
  swarmEventsInFeed: boolean;
  maxConcurrentSpawns: number;

  // New V1 surface.
  supervisor: SupervisorConfig;
}
```

Messaging-related retained fields may be removed after their code is removed. During the refactor, keeping them avoids unrelated configuration breakage.

## 9.3 Defaults

```ts
const DEFAULT_SUPERVISOR: SupervisorConfig = {
  enabled: false,
  paused: false,
  pollIntervalMs: 15_000,
  maxStartsPerTick: 2,
  workerPools: [
    {
      id: 'default',
      workers: 3,
      model: { mode: 'inherit' },
      enabled: true,
    },
  ],
  coordinator: {
    enabled: false,
    model: { mode: 'inherit' },
    mode: 'manual',
  },
  beadEnricher: {
    enabled: false,
    model: { mode: 'inherit' },
    mode: 'manual',
  },
};
```

The default worker count remains aligned with the current upstream `maxConcurrentSpawns` default of three.

## 9.4 Model semantics

### Inherit

```json
{ "mode": "inherit" }
```

Spawn behavior:

```text
no --provider
no --model
no --thinking
```

Pi uses the current user's normal model selection and settings.

### Exact

```json
{
  "mode": "exact",
  "model": "provider/model-id"
}
```

Spawn behavior uses the already-proven upstream conversion:

```text
provider/model-id
  → --provider provider --model model-id
```

The model must appear in the current Pi user's available model list.

## 9.5 Model precedence

For a pool-managed worker:

```text
pool exact model
  → use exact pool model

pool inherit
  → pass no provider/model override
  → Pi uses the current user's normal selection
```

A role-file model never overrides a managed pool. Shipped role files contain no
model frontmatter.

For manual `spawn`:

```text
explicit --model
  → agent-file model
  → Pi default
```

The resolved requested model is stored in the spawn record.

## 9.6 Pool validation

Validation rules:

```text
id
  non-empty, unique, [A-Za-z0-9._-]

workers
  integer 0..64

model exact
  non-empty provider/model string
  exact match in fresh Pi inventory during setup

roleFile
  readable when supplied

sum of enabled worker targets
  may exceed maxConcurrentSpawns
  status explains the effective cap
```

V1 does not implement weighted fair sharing. If targets exceed the global limit, refill uses deterministic round-robin across pool definitions.

## 9.7 Deterministic pool allocation under a global cap

```ts
export function poolRefillOrder(
  pools: WorkerPoolRuntime[],
  globalFree: number,
): string[] {
  const result: string[] = [];
  const mutable = pools.map((pool) => ({
    ...pool,
    missing: Math.max(0, pool.target - pool.running),
  }));

  while (result.length < globalFree) {
    let added = false;
    for (const pool of mutable) {
      if (result.length >= globalFree) break;
      if (!pool.enabled || pool.missing <= 0 || !pool.modelAvailable) continue;
      result.push(pool.id);
      pool.missing--;
      added = true;
    }
    if (!added) break;
  }

  return result;
}
```

This is easy to test and explain. More advanced fairness belongs after real usage proves it is needed.

## 9.8 Example configuration

```json
{
  "maxConcurrentSpawns": 10,
  "supervisor": {
    "enabled": true,
    "paused": false,
    "pollIntervalMs": 15000,
    "maxStartsPerTick": 2,
    "workerPools": [
      {
        "id": "primary",
        "workers": 6,
        "model": {
          "mode": "exact",
          "model": "provider/model"
        },
        "enabled": true
      },
      {
        "id": "glm",
        "workers": 4,
        "model": {
          "mode": "exact",
          "model": "umans/glm-5.2"
        },
        "enabled": true
      }
    ],
    "coordinator": {
      "enabled": true,
      "model": {
        "mode": "exact",
        "model": "openai-codex/sol"
      },
      "mode": "manual"
    },
    "beadEnricher": {
      "enabled": false,
      "model": {
        "mode": "inherit"
      },
      "mode": "manual"
    }
  }
}
```

The model strings are owner examples. The package does not ship them.

---

# 10. Setup and Model Discovery

## 10.1 Setup command

```bash
pi-messenger-swarm setup [options]
```

Options:

```text
--worker MODEL_OR_INHERIT=COUNT    repeatable
--coordinator MODEL_OR_INHERIT
--no-coordinator
--max-concurrent N
--poll-seconds N
--max-starts-per-tick N
--start
--dry-run
--json
```

## 10.2 Model discovery uses Pi

The fork does not read provider credential files.

It asks Pi for configured models through the documented RPC command:

```json
{"id":"models-1","type":"get_available_models"}
```

Expected response category:

```json
{
  "type": "response",
  "command": "get_available_models",
  "success": true,
  "data": {
    "models": []
  }
}
```

## 10.3 Minimal RPC probe

```ts
export async function queryAvailablePiModels(options: {
  piBinary: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<PiModelInfo[]> {
  const child = spawn(options.piBinary, [
    '--mode',
    'rpc',
    '--no-session',
    '--no-tools',
    '--no-context-files',
  ], {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  // Parse LF-delimited RPC frames. Do not use a line splitter that treats
  // Unicode line separators as protocol delimiters.
  child.stdin.write(JSON.stringify({
    id: 'models-1',
    type: 'get_available_models',
  }) + '\n');

  // Resolve on the correlated response, then terminate the probe.
  // Full implementation includes bounded stdout/stderr and timeout cleanup.
}
```

This is a small Pi-specific probe, not a reusable RPC platform.

## 10.4 Cached inventory

Cache one inventory per effective Pi binary for 60 seconds:

```ts
interface ModelInventoryCache {
  fetchedAt: number;
  piBinary: string;
  models: PiModelInfo[];
  inFlight?: Promise<PiModelInfo[]>;
}
```

Use cases:

```text
setup wizard
models command
supervisor ticks with exact-model pools
configuration reload
exact-model spawn validation
```

If model discovery fails at runtime, `inherit` pools remain eligible because they
pass no model override. Exact-model pools are displayed as temporarily
unavailable until a later refresh succeeds.

A worker spawn does not launch a separate model-discovery process when a fresh cache exists.

## 10.5 Setup validation output

```text
✓ Pi binary             /home/user/.local/bin/pi
✓ Pi models             14 available
✓ AGENTS.md              /path/to/project/AGENTS.md
✓ .beads                 /path/to/project/.beads
✓ br                     found
✓ bv                     found
? Agent Mail in Pi       run --live-check to verify
? pre-commit guard       not checked
✓ branch                 main

Worker pools
  primary    provider/model      6
  glm        umans/glm-5.2       4

Coordinator
  openai-codex/sol               manual

Global maximum                       10
```

## 10.6 Live Agent Mail probe

The supervisor does not implement Agent Mail.

Phase 0 records one read-only probe that is actually supported by the user's
installed Pi MCP adapter and Agent Mail server. The implementation of:

```bash
pi-messenger-swarm doctor --live-agent-mail
```

launches a short-lived Pi process and executes only that captured probe. If the
installed adapter exposes no proven read-only probe, the command reports
`unsupported` and gives the manual verification step; it does not invent a tool
name, register an identity, reserve files, or mutate Beads.

The exact MCP adapter, server, auth, and tool/resource names remain owned by the
user's Pi installation.

## 10.7 Configuration write

Setup writes the existing project file:

```text
.pi/pi-messenger.json
```

Implementation:

```text
read existing JSON
fail with path + parse error if malformed
merge only the supervisor/maxConcurrentSpawns fields
write temporary file beside target
rename temporary file to target
preserve unrelated existing fields
```

No new configuration dependency is required.

---

# 11. Continuous Supervisor Loop

## 11.1 New module

Add:

```text
swarm/supervisor.ts
```

One `ProjectSupervisor` instance runs per explicitly started project in the harness process.

## 11.2 Minimal state

```ts
export interface ProjectSupervisorSnapshot {
  cwd: string;
  enabled: boolean;
  paused: boolean;
  lastTickAt?: string;
  nextTickAt?: string;
  lastReadyCount?: number;
  lastSpawnedCount?: number;
  lastReason?: string;
  lastError?: string;
}

export const SUPERVISOR_SESSION_ID = 'pi-swarm-supervisor';

export class ProjectSupervisor {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private tickAgain = false;

  constructor(
    readonly cwd: string,
    private readonly readConfig: () => MessengerConfig,
    private readonly modelCatalog: PiModelCatalog,
  ) {}
}
```

Managed pool workers use the stable local event-log session ID
`pi-swarm-supervisor`. Manual spawns continue to use the calling Pi session ID.
This keeps managed-worker history independent of the operator's current chat
session while reusing the existing per-session JSONL implementation.

## 11.3 Start and stop

```ts
start(): void {
  if (this.timer) return;
  const config = this.readConfig();
  this.timer = setInterval(
    () => void this.requestTick('interval'),
    config.supervisor.pollIntervalMs,
  );
  void this.requestTick('start');
}

stop(): void {
  if (this.timer) clearInterval(this.timer);
  this.timer = null;
}
```

## 11.4 Coalesced ticks

```ts
async requestTick(reason: string): Promise<void> {
  if (this.ticking) {
    this.tickAgain = true;
    return;
  }

  this.ticking = true;
  try {
    do {
      this.tickAgain = false;
      await this.tick(reason);
    } while (this.tickAgain);
  } finally {
    this.ticking = false;
  }
}
```

This reuses ordinary in-process serialization. V1 does not add a project actor or transaction coordinator.

## 11.5 Tick algorithm

```ts
async tick(reason: string): Promise<void> {
  const firstConfig = loadConfig(this.cwd);

  cleanupExitedSpawnedForProject(this.cwd);
  reconcileSpawnedForProject(this.cwd);

  if (!firstConfig.supervisor.enabled || firstConfig.supervisor.paused) {
    return this.recordIdle(firstConfig.supervisor.paused ? 'paused' : 'disabled');
  }

  if (listProjectRunningSpawns(this.cwd).length >= firstConfig.maxConcurrentSpawns) {
    return this.recordIdle('capacity_full');
  }

  const ready = await readReadyBeads(this.cwd, {
    limit: Math.min(100, firstConfig.maxConcurrentSpawns * 4),
  });
  if (ready.length === 0) return this.recordIdle('no_ready_beads');

  // A catalog failure does not block inherit pools. It marks exact pools
  // unavailable until the next successful refresh.
  const modelInventory = await this.modelCatalog.getOrEmptyOnFailure();

  // `br` and Pi model discovery were external reads. Re-read process occupancy and configuration
  // before spawning so a manual spawn or config mutation that occurred while
  // `br` was running cannot use stale capacity.
  const config = loadConfig(this.cwd);
  if (!config.supervisor.enabled || config.supervisor.paused) {
    return this.recordIdle(config.supervisor.paused ? 'paused' : 'disabled');
  }

  const running = listProjectRunningSpawns(this.cwd);
  const globalFree = Math.max(0, config.maxConcurrentSpawns - running.length);
  if (globalFree === 0) return this.recordIdle('capacity_full');

  // A newly started worker may need time to read AGENTS.md, join Agent Mail,
  // and claim. Count workers without a reported currentBeadId as pending
  // selectors so repeated ticks do not launch more selectors than visible work.
  const pendingSelectors = running.filter(
    (worker) => !worker.currentBeadId && worker.managedPoolWorker === true,
  ).length;
  const availableReadyDemand = Math.max(0, ready.length - pendingSelectors);
  if (availableReadyDemand === 0) return this.recordIdle('workers_selecting_work');

  const pools = buildPoolRuntime(config, running, modelInventory);
  const poolOrder = poolRefillOrder(pools, globalFree);
  const starts = Math.min(
    config.supervisor.maxStartsPerTick,
    poolOrder.length,
    availableReadyDemand,
  );

  for (let i = 0; i < starts; i++) {
    const pool = requirePool(config, poolOrder[i]);
    spawnPoolWorker(this.cwd, pool, SUPERVISOR_SESSION_ID);
  }
}
```

## 11.6 `br` is read-only in the supervisor

The supervisor may call:

```bash
RUST_LOG=error br ready --json --limit N
RUST_LOG=error br show ID --json
RUST_LOG=error br list --status in_progress --json
```

It does not call:

```text
br update
br close
br reopen
br dep add/remove
br comments add
br sync
```

Those remain worker/operator actions governed by `AGENTS.md`.

## 11.7 Ready-result normalizer

Do not scatter raw output assumptions through the supervisor.

```ts
export interface ReadyBead {
  id: string;
  title: string;
  priority?: number;
  labels: string[];
}

export function normalizeReadyBeads(raw: unknown): ReadyBead[] {
  // Implement against the captured installed br fixture.
  // Reject an unsupported shape with an actionable diagnostic.
}
```

Phase 0 captures the actual installed `br ready --json` result and tests the normalizer.

## 11.8 Refill triggers

Call `requestTick()` on:

```text
supervisor start
periodic timer
worker process close
worker process error
no-claim terminal event starts selection backoff
manual worker stop
pool configuration change
supervisor resume
manual refresh
```

Do not call it for every Pi tool event.

## 11.9 Spawn staggering

`maxStartsPerTick` defaults to two.

With a 15-second interval and ten empty slots:

```text
tick 1 → start 2
tick 2 → start 2
tick 3 → start 2
...
```

An optional short follow-up timer may request another tick after five seconds while unfilled capacity and unreserved ready-work demand remain. The hard per-tick cap remains in force.

## 11.10 No-claim selection backoff

A managed worker that exits without ever reporting `currentBeadId` did not
establish local evidence of a successful claim. Its terminal callback sets an
in-memory project backoff:

```ts
const NO_CLAIM_BACKOFF_MS = 60_000;
```

During that interval the supervisor reports `selection_backoff` and starts no new
selectors. The backoff is not durable and resets on harness restart. Its purpose
is only to avoid an immediate token-spending loop when Agent Mail is unavailable,
all visible work conflicts, or several agents repeatedly prefer the same Bead.

## 11.11 No automatic same-Bead retry

When a worker fails:

```text
record failure
free pool slot
refill from current br ready set
```

The failed Bead may remain `in_progress`; the supervisor does not reset or reclaim it automatically.

This matches the Flywheel's human/Agent-Mail recovery model and avoids inventing claim compensation logic.

## 11.12 Supervisor status reasons

Stable reasons:

```text
running
paused
disabled
no_ready_beads
workers_selecting_work
selection_backoff
capacity_full
no_enabled_pool
pool_model_unavailable
br_unavailable
config_error
starting_workers
```

---

# 12. Worker Self-Selection and Ready-Work Capacity

## 12.1 Workers self-select through the existing Flywheel workflow

The supervisor does not assign a specific Bead. It starts a generic one-Bead worker only when `br ready --json` shows available work.

The worker then follows the existing project workflow:

```text
read AGENTS.md and README.md
  → join/check Agent Mail
  → run bv --robot-triage or inspect br ready
  → atomically claim one Bead through br
  → reserve paths and announce work
  → implement one Bead
  → complete the project-defined close/sync/push workflow
  → exit
```

This is the same work-selection pattern already documented by the Agent Flywheel guide. The fork automates process supply, not task assignment.

## 12.2 Ready-work count limits new selectors

`br ready` excludes work that is already `in_progress`. The remaining race is the interval between a new Pi process starting and that process completing its claim.

The supervisor therefore treats every live managed worker without a reported `currentBeadId` as a pending selector:

```ts
const pendingSelectors = runningWorkers.filter(
  (worker) => worker.managedPoolWorker && !worker.currentBeadId,
).length;

const availableReadyDemand = Math.max(
  0,
  readyBeads.length - pendingSelectors,
);
```

This is local capacity accounting only. It is not a claim or reservation.

## 12.3 Claim procedure

The implementer role says:

```text
1. Read AGENTS.md and README.md.
2. Register/resume Agent Mail and check current coordination.
3. Use bv --robot-triage / br ready to select one useful ready Bead.
4. Attempt the installed atomic br claim workflow.
5. If the claim fails, do not edit; refresh and choose another ready Bead.
6. After a successful claim, report the Bead through worker status.
7. If no useful claim succeeds, report idle/no-work and exit 0.
```

## 12.4 Claim conflicts are normal

Several workers may initially prefer the same high-impact Bead. The `br` claim is the arbiter. A rejected claim is not a worker-process failure and does not justify force, reset, or claim stealing.

## 12.5 Spawn metadata

```ts
export interface SpawnRequest {
  role?: string;
  persona?: string;
  objective?: string;
  message?: string;
  context?: string;
  taskId?: string;       // legacy during migration
  poolId?: string;
  model?: string;
  name?: string;
  agentFile?: string;
  managedPoolWorker?: boolean;
}
```

```ts
export interface SpawnedAgent {
  // existing fields ...
  poolId?: string;
  managedPoolWorker?: boolean;
  currentBeadId?: string;
  phase?: WorkerPhase;
  statusMessage?: string;
  lastProgressAt?: string;
  requestedModel?: string;
  actualModel?: string;
}
```

During migration, `taskId` may continue to populate legacy display code, but managed pool workers do not receive Pi Messenger task IDs.

---

# 13. Pi Worker Launch and Session Behavior

## 13.1 Fix model wiring end to end

Required path:

```text
CLI --model
  → MessengerActionParams.model
  → SpawnRequest.model
  → spawn handler
  → spawnSubagent
  → createArgs
  → Pi arguments
```

## 13.2 Resolved model

```ts
const resolvedModel = request.managedPoolWorker
  ? request.model
  : request.model ?? agentFileModel;
```

Use `resolvedModel` for:

```text
Pi arguments
SpawnedAgent.requestedModel
SpawnedAgent.model during compatibility migration
human status output
```

## 13.3 Stop using ephemeral sessions for managed workers

Current:

```ts
const args = ['--mode', 'json', '--no-session'];
```

Target:

```ts
const args = [
  '--mode',
  'json',
  '--name',
  `pi-swarm worker ${state.name}`,
];
```

Pi saves the session under its normal user-owned session directory.

The supervisor records no credentials and does not parse session contents.

## 13.4 Target argument construction

```ts
function createArgs(state: SpawnState, model?: string): string[] {
  const args = [
    '--mode',
    'json',
    '--name',
    `pi-swarm worker ${state.name}`,
  ];

  if (model) {
    const slash = model.indexOf('/');
    if (slash !== -1) {
      args.push(
        '--provider',
        model.slice(0, slash),
        '--model',
        model.slice(slash + 1),
      );
    } else {
      args.push('--model', model);
    }
  }

  args.push('--extension', EXTENSION_DIR);

  for (const skillPath of discoverSkills(state.cwd)) {
    args.push('--skill', skillPath);
  }

  if (state.systemPrompt.trim()) {
    const promptPath = writeTemporaryRolePrompt(state);
    args.push('--append-system-prompt', promptPath);
  }

  args.push(state.prompt);
  return args;
}
```

## 13.5 Context files remain enabled

Do not pass:

```text
--no-context-files
```

Pi therefore loads the applicable user, parent, and project `AGENTS.md`/`CLAUDE.md` files through its native context mechanism.

## 13.6 Project trust

Non-interactive Pi uses the user's saved/default project-trust policy unless explicitly overridden.

Setup reports trust status. The fork does not silently append `--approve`.

Optional config may allow:

```json
{
  "projectTrust": "inherit"
}
```

V1 values:

```text
inherit
approve-for-this-spawn
no-approve-for-this-spawn
```

Default is `inherit`.

## 13.7 Worker environment

Retain the normal environment so Pi's existing authentication continues to work.

Add non-secret metadata:

```ts
const env = {
  ...process.env,
  PI_SWARM_SPAWNED: '1',
  PI_SWARM_SPAWN_ID: id,
  PI_SWARM_POOL_ID: request.poolId ?? '',
  PI_AGENT_NAME: name,
  AGENT_NAME: name,
};
```

`PI_AGENT_NAME` and `AGENT_NAME` help the worker request the same identity in Agent Mail and satisfy the reservation pre-commit guard convention.

## 13.8 Actual model capture

`PiEvent.message.model` already exists in the progress event type.

Extend progress:

```ts
export interface AgentProgress {
  // existing fields ...
  actualModel?: string;
}
```

```ts
case 'message_end':
  if (event.message?.model) {
    progress.actualModel = event.message.model;
  }
  // existing token/error handling
  break;
```

Update the runtime/spawn record when an actual model is observed.

## 13.9 Worker role file

Shipped path:

```text
agents/implementer.md
```

It contains no model frontmatter. Pool configuration owns the model.

## 13.10 First user message

The initial mission includes:

```text
pool ID
worker name
instruction to read AGENTS.md and README first
instruction to use bv/br to select and claim one ready Bead
instruction to use the established Agent Mail workflow
instruction to do one Bead then exit
local worker-status command examples
```

The supervisor does not copy a Bead body into the prompt or choose the worker's task.

---

# 14. `AGENTS.md` and the ACFS Operating Contract

## 14.1 `AGENTS.md` is authoritative for worker behavior

The fork does not hard-code project-specific rules for:

```text
DCG
SLB
UBS
RCH
no script-based changes
ast-grep vs rg
formatting
compiler checks
tests
E2E
Git pull/commit/push
Beads sync
file deletion
project-specific branch rules
```

Those instructions already belong in `AGENTS.md` and project skills.

## 14.2 Worker startup order

```text
Pi process starts in project cwd
  → Pi natively loads context files
  → implementer role is appended
  → first user mission arrives
  → worker's first required action is reading AGENTS.md
  → worker reads README.md
  → only then does it register, claim, reserve, or edit
```

## 14.3 Canonical kickoff block

```text
First read ALL of AGENTS.md and README.md carefully and understand them.
They define the project rules, safety requirements, tools, checks, Git workflow,
and coordination protocol. Follow them even when this generic mission is shorter.

Then register or resume your MCP Agent Mail identity, using PI_AGENT_NAME as the
requested name when supported. Check your inbox and active agents. Use bv and br
to select and atomically claim one ready Bead, reserve the smallest exact file set
in Agent Mail, announce the work in the Bead thread, and implement that one Bead
completely.

After implementation, follow AGENTS.md for checks, self-review, UBS/RCH/DCG,
Git commit/push, Beads completion/sync, reservation release, and handoff. Then exit.
```

## 14.4 After compaction

The role file includes:

```text
After any context compaction, reread the root AGENTS.md before continuing.
```

## 14.5 Missing `AGENTS.md`

For `supervisor start`:

```text
AGENTS.md missing
  → refuse unattended start
  → print exact project path
```

Manual `spawn` retains the upstream behavior and is not described as an unattended
Agent Flywheel worker. The continuous supervisor requires a root `AGENTS.md`.

## 14.6 No rules hash protocol in V1

V1 does not invent a model acknowledgment or content-hash handshake.

The guarantee is limited to:

```text
context loading remained enabled
worker was explicitly instructed to read the file first
worker ran in the correct project cwd
```

The system does not claim proof that a language model internalized every line.

## 14.7 Project skills

Keep upstream skill discovery:

```text
~/.pi/agent/skills/*/SKILL.md
<project>/.pi/skills/*/SKILL.md
```

Do not copy ACFS tool documentation into the package. The project `AGENTS.md` and installed skills remain the reusable source.

---

# 15. Direct `br`, `bv`, and Agent Mail Workflow

## 15.1 Worker-direct integration

The worker calls the existing tools directly. The supervisor does not proxy them.

```text
worker → br CLI
worker → bv robot CLI
worker → MCP Agent Mail tools/resources
```

## 15.2 Beads commands

The worker follows the installed `br` syntax and the project's `AGENTS.md`.

Typical current commands:

```bash
RUST_LOG=error br show "$BEAD_ID" --json
RUST_LOG=error br --actor "$AGENT_NAME" update "$BEAD_ID" --claim --json
RUST_LOG=error br ready --json
RUST_LOG=error br comments add "$BEAD_ID" "Progress: ..."
RUST_LOG=error br close "$BEAD_ID" --reason "Completed" --json
RUST_LOG=error br sync --flush-only
```

The exact final command sequence remains project-defined by `AGENTS.md`.

## 15.3 `bv` commands

The worker uses only robot flags:

```bash
bv --robot-triage
bv --robot-next
bv --robot-plan
bv --robot-insights
```

Never run bare `bv` in a worker prompt because it opens the interactive TUI.

## 15.4 Agent Mail workflow

The worker follows the installed MCP Agent Mail skill or project instructions.

Expected conceptual flow:

```text
ensure/register identity
fetch inbox
inspect active agents
reserve exact files or globs
send [bead-id] start message
work and reply with material progress
release reservations
send completion/block message
```

Use the Bead ID consistently as:

```text
thread ID
message subject prefix
reservation reason
commit reference
```

## 15.5 Identity alignment

The harness generates a memorable Pi worker name and exports:

```text
PI_AGENT_NAME
AGENT_NAME
```

The worker requests that name from Agent Mail when the installed tool supports requested names.

If Agent Mail returns a different name, the worker reports it through:

```bash
pi-messenger-swarm worker status --agent-name ACTUAL_NAME
```

The local spawn name remains runtime identity; the reported Agent Mail name is display metadata.

## 15.6 Reservations stay advisory

The fork does not call Agent Mail reservation APIs itself.

It relies on:

```text
worker compliance with AGENTS.md
Agent Mail reservation conflict output
Agent Mail TTL expiry
Agent Mail pre-commit guard
shared-main awareness
small exact commits
```

The UI labels reservations as external/advisory. It does not show a false “filesystem enforced” badge.

## 15.7 Inbox cadence

The worker kickoff says to:

```text
check inbox before claiming
check after receiving conflict/blocking signals
check before final commit/push
acknowledge messages requiring acknowledgment
```

It does not require polling after every few tool calls unless the project `AGENTS.md` says so.

## 15.8 No local message mirroring

The fork does not copy Agent Mail message bodies into `.pi/messenger`.

The runtime may store only:

```text
external Agent Mail name
last worker-reported coordination phase
optional thread ID (= Bead ID)
```

## 15.9 Stale claims

The supervisor does not reclaim claims.

Operator/coordinator workflow:

```bash
br list --status in_progress --json
br coordination status --json
```

Then inspect Agent Mail evidence before any reclaim action.

---

# 16. Shared-`main` Git Workflow

## 16.1 Normal model

```text
one shared checkout
one main branch
several workers
exact reservations
small commits
fast pushes
```

This matches the selected Agent Flywheel guide rather than a worktree architecture.

## 16.2 Workers own their Git actions

The supervisor does not stage, commit, pull, rebase, or push.

Every worker follows the target project's `AGENTS.md`.

This is a deliberate reversal of earlier plan drafts that invented a serialized landing lane.

## 16.3 Why no custom Git lane

The purpose of this fork is to automate Pi process farming, not to replace the proven shared-main workflow.

A custom landing service would introduce:

```text
index ownership rules
commit reconstruction
push reconciliation
Beads/Git transaction semantics
result manifests
foreign-diff attribution
repair commands
```

None is necessary to prove the core product.

## 16.4 Conflict prevention

The existing workflow uses:

- Beads to prevent task duplication;
- Agent Mail to announce intent and reserve paths;
- the Agent Mail pre-commit guard;
- DCG rules from `AGENTS.md`;
- exact staging;
- small commits;
- immediate pushes;
- communication when overlaps appear.

## 16.5 Unrelated changes

The worker role repeats the standard shared-checkout rule:

```text
Other agents' changes are expected. Do not stash, reset, restore, format, stage,
commit, or otherwise disturb unrelated paths. Work only on your claimed Bead and
reserved files. Stage exact files, never broad working-tree contents.
```

## 16.6 Broad Git commands

The role discourages:

```text
git add .
git add -A
git commit -a
```

The worker follows the stricter wording in `AGENTS.md` where present.

## 16.7 Pull/rebase behavior

The package does not impose a universal Git sequence. Some project `AGENTS.md` files require:

```bash
git pull --rebase
git push
```

Others may use different rules. The worker follows the project contract.

The supervisor only reports the current branch and dirty-file count in diagnostics.

## 16.8 Worktree support

No worktree feature is implemented in V1.

A future optional mode requires a separate plan because it changes:

```text
Agent Mail project binding
Pi cwd
session organization
build caches
Git integration
result delivery
```

---

# 17. Worker Telemetry and Runtime Records

## 17.1 Telemetry is not work authority

Local worker status exists only to improve the operator UI.

`br` remains authoritative for task state; Agent Mail remains authoritative for coordination.

## 17.2 Worker phases

```ts
export type WorkerPhase =
  | 'starting'
  | 'reading_rules'
  | 'coordinating'
  | 'claiming'
  | 'implementing'
  | 'testing'
  | 'reviewing'
  | 'committing'
  | 'finishing'
  | 'blocked'
  | 'idle';
```

## 17.3 Status command

```bash
pi-messenger-swarm worker status \
  --phase implementing \
  --bead br-123 \
  --message "Parser complete; adding regression tests"
```

All fields except phase are optional.

## 17.4 Worker status action

```ts
export interface WorkerStatusUpdate {
  spawnId: string;
  phase?: WorkerPhase;
  beadId?: string;
  message?: string;
  agentMailName?: string;
}
```

The CLI obtains `spawnId` from `PI_SWARM_SPAWN_ID`. Human callers may provide `--spawn-id` explicitly.

## 17.5 Updating a spawn record

Add to `swarm/spawn.ts`:

```ts
export function updateSpawnStatus(
  cwd: string,
  id: string,
  patch: Partial<Pick<
    SpawnedAgent,
    'phase' | 'currentBeadId' | 'statusMessage' | 'agentMailName'
  >>,
): SpawnedAgent | null {
  const runtime = runtimes.get(id);
  if (!runtime || runtime.record.cwd !== cwd) return null;

  runtime.record = {
    ...runtime.record,
    ...patch,
    lastProgressAt: new Date().toISOString(),
  };

  appendEvent(cwd, runtime.record.sessionId ?? '', {
    id,
    type: 'progress',
    timestamp: runtime.record.lastProgressAt,
    agent: patch,
  });

  generateAgentFile(
    cwd,
    runtime.record.sessionId ?? '',
    runtime.record,
  );

  return runtime.record;
}
```

Detached restored runtimes remain updateable because the record is still in the runtime map.

## 17.6 Status update failures

The worker status command is best effort.

A failure must not block:

```text
claim
implementation
testing
commit
Bead completion
Agent Mail communication
```

## 17.7 Existing Pi progress

Continue using the current progress parser for:

```text
current tool
current tool arguments preview
recent tools
tool count
tokens
elapsed duration
Pi error message
actual model
```

## 17.8 Persisted events

Continue the current `SpawnEvent` model, extended with pool/Bead/phase metadata:

```ts
interface SpawnEvent {
  id: string;
  type: 'spawned' | 'completed' | 'failed' | 'stopped' | 'progress';
  timestamp: string;
  agent: Partial<SpawnedAgent>;
}
```

No new event store is introduced.

## 17.9 History output

`spawn history` becomes `worker history` in human-facing documentation, while a compatibility alias may remain during V1.

Display:

```text
id
name
pool
requested model
actual model
current claimed Bead
phase
status
start/end
exit code
error summary
```

## 17.10 Attention derived from local records

The UI may derive attention when:

```text
worker failed
worker stopped unexpectedly
restored worker has no live output
current Bead remains in_progress after worker exit
pool exact model unavailable
supervisor cannot read br ready
```

This is display logic, not a new task state.

---

# 18. Durability and Recovery

## 18.1 Use the current recovery system

Keep:

```text
append-only per-session spawned-agent JSONL
spawn-runtimes.json on clean harness shutdown
restoreRuntimes() on startup
reconcileAndRestoreOrphans() after crash
PID liveness polling for detached runtimes
```

## 18.2 Add pool metadata to persisted records

Because `spawn-runtimes.json` stores the complete `SpawnedAgent` record, adding:

```text
poolId
managedPoolWorker
currentBeadId
requestedModel
actualModel
phase
```

makes restored pool occupancy reconstructible without a new store. Managed workers
also share the stable local history key `pi-swarm-supervisor`, so the existing
agent-event loader can recover their history without depending on an operator
Pi session ID.

## 18.3 Supervisor recovery

On supervisor start:

```text
load config
reconcile dead spawned records
restore/live-count running workers
count running workers by pool
call br ready --json
fill missing capacity
```

## 18.4 Harness replacement

The existing `/quit` preserve-spawns path writes live runtimes and exits without killing worker processes.

The replacement harness restores those PIDs.

The supervisor loop then starts from restored occupancy rather than assuming every configured slot is empty.

## 18.5 Harness crash

If no `spawn-runtimes.json` was written:

```text
scan agent JSONL
find records still marked running
PID alive → restore detached runtime
PID dead  → append failed tombstone
```

## 18.6 Lost live progress

After harness crash, the new harness cannot regain old stdout/stderr pipes.

The UI displays:

```text
DETACHED · PID alive · live output unavailable
```

The process is not duplicated merely because output is unavailable.

## 18.7 Saved Pi sessions

Managed workers no longer pass `--no-session`, so Pi writes normal user-owned session history.

Benefits:

- the operator can inspect or resume the session through Pi's normal session tooling;
- crash debugging has a Pi-owned session artifact;
- external session-history tools may index it according to their own installed configuration;
- the fork does not need a custom transcript store.

## 18.8 Automatic replacement

Automatic replacement occurs at the pool level, not as a same-Bead retry.

```text
worker terminal
  → runtime event persisted
  → supervisor tick
  → free pool slot
  → current ready set inspected
  → fresh worker may start
```

## 18.9 In-progress Bead with no live worker

The supervisor may perform a read-only check:

```bash
br show <current-bead> --json
```

If the Bead remains `in_progress`, status displays attention and optionally triggers the coordinator tender.

No automatic claim reset occurs.

## 18.10 Stop semantics

```text
supervisor stop
  stops refill only

worker stop ID
  sends TERM, then KILL through existing spawn runtime logic

harness --stop
  existing explicit hard shutdown behavior
```

## 18.11 Durability limitations stated plainly

V1 does not guarantee:

- exact process-tree termination beyond current upstream behavior;
- PID-reuse-proof ownership;
- transactional event writes;
- recovery of lost stdout pipes;
- automatic continuation after a machine reboot;
- automatic resumption of a failed worker session;
- exactly-once Bead execution.

The plan avoids claiming those properties because they are not present in the pinned runtime.

## 18.12 When stronger durability becomes justified

A separate runtime redesign becomes justified only after shipped evidence shows failures such as:

```text
frequent duplicate workers caused by harness overlap
material loss caused by JSONL partial writes
unacceptable inability to recover process output
unsafe PID signaling in real operation
multi-project scheduling requirements
```

Until then, extending the current runtime is the lower-risk path.

---

# 19. Optional Coordinator Tender

## 19.1 Purpose

The coordinator helps tend an existing swarm. It does not own work allocation or implementation.

It is useful for:

- inspecting stalled `in_progress` Beads;
- checking Agent Mail for unanswered requests;
- noticing workers that exited with unfinished work;
- suggesting clarifications or Bead splits;
- nudging agents toward higher-impact ready work;
- reporting system-level concerns to the operator.

## 19.2 One-shot design

The coordinator is an ordinary one-shot Pi spawn using the existing spawn path.

```text
spawn coordinator
  → read AGENTS.md
  → inspect br/bv/Agent Mail/worker status
  → send messages or report recommendations
  → exit
```

No persistent RPC process or coordinator session manager is added.

## 19.3 Modes

```text
manual
  only `coordinator run`

interval
  at most one run per configured interval
  skip when another coordinator run is active
```

Default is disabled/manual.

## 19.4 Coordinator model

Uses the same `PiModelSelection` contract as worker pools.

```json
{
  "enabled": true,
  "model": {
    "mode": "exact",
    "model": "openai-codex/sol"
  },
  "mode": "manual"
}
```

The example model is validated through Pi and is not shipped.

## 19.5 Coordinator role contract

```text
Read AGENTS.md and README.md first.
Do not edit product source unless the operator explicitly launched an implementation worker.
Do not claim an implementation Bead.
Inspect worker status, br ready/in-progress state, bv robot output, and Agent Mail.
Send concise targeted messages when a worker is blocked or coordination is missing.
Do not become a load-bearing scheduler; the pool continues without you.
Return a concise operator summary and exit.
```

## 19.6 Trigger conditions for interval mode

Run only when at least one condition is true:

```text
failed worker since last coordinator run
in-progress Bead with no corresponding live local worker
no ready Beads but open/in-progress work remains
operator requested coordinator wake
```

Do not run merely because a timer fired when the project is healthy and idle.

## 19.7 No supervisor control tools

The coordinator may call normal project tools because it is an ordinary Pi agent, but it is not given a special daemon mutation API.

It cannot alter pool configuration or start/stop workers except through the same CLI a human could use, and the shipped role tells it not to do so.

## 19.8 Coordinator failure

A failed coordinator run:

```text
is recorded in worker history
opens no retry loop by default
does not pause worker refill
does not change Beads
```

---

# 20. Optional Bead Enricher

## 20.1 Purpose

The Enricher improves one existing Bead before implementation by checking:

```text
description clarity
acceptance criteria
test obligations
dependency completeness
overlap with existing Beads
relevant plan references
likely file surface
```

## 20.2 Manual V1 command

```bash
pi-messenger-swarm bead enrich br-123
```

Optional model:

```bash
pi-messenger-swarm bead enrich br-123 \
  --model provider/model
```

## 20.3 Default suggestion-only behavior

The Enricher:

1. reads `AGENTS.md` and relevant plan/Bead context;
2. uses `br show`, `br list`, dependencies, comments, and `bv` as needed;
3. produces a structured review;
4. adds one review comment to the Bead when instructed by the operator command;
5. does not edit source;
6. does not claim or close the Bead.

## 20.4 Apply behavior

V1 has no automatic field-rewrite mode.

The Enricher may print exact proposed commands for operator review, such as:

```bash
br update br-123 --acceptance-criteria "..."
br update br-123 --description "..."
br dep add br-123 br-099
```

The operator or a later explicitly authorized run applies them.

## 20.5 Enricher role contract

```text
Read AGENTS.md first.
Do not edit source files.
Do not claim, close, reopen, or reassign the target Bead.
Inspect the target and related open Beads for duplication and missing dependencies.
Prefer adding a review comment over rewriting owner-authored content.
Return exact proposed br commands for substantive changes.
Exit after one Bead review.
```

## 20.6 Batch mode

Post-V1 may support:

```bash
pi-messenger-swarm bead enrich-ready --limit 5
```

It is not in the V1 hot path. Normal implementation admission never waits for enrichment.

---

# 21. CLI Design

## 21.1 Keep the current executable name

V1 continues to ship:

```text
pi-messenger-swarm
```

A later rename can be evaluated after the fork is working. Renaming the package, CLI, state directory, extension command, and docs during the core refactor adds no execution value.

## 21.2 Bare invocation

```bash
pi-messenger-swarm
```

Output:

```text
Pi Worker Pool for the Agent Flywheel

Quick start
  pi-messenger-swarm setup
  pi-messenger-swarm supervisor start
  pi-messenger-swarm status

Common commands
  models [search]              Show models visible to the current Pi user
  pool list                    Show configured and running pool counts
  worker list                  Show live workers
  coordinator run              Run one optional tending pass
  bead enrich ID               Review one Bead

Use --json for machine-readable output.
```

Exit code is zero.

## 21.3 Output modes

Global flags:

```text
--json
--plain
--quiet
--debug
--no-color
```

Rules:

```text
TTY + no --json     human tables and concise panels
non-TTY             plain output unless --json
--json              one JSON object per ordinary command
NO_COLOR            no ANSI
TERM=dumb           plain ASCII-safe output
```

## 21.4 Stable response envelope

```ts
export interface CliResponse<T> {
  ok: boolean;
  command: string;
  project?: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    hint?: string;
  };
}
```

The existing harness response may remain internally compatible during migration. The natural CLI normalizes it for new commands.

## 21.5 Setup commands

```text
setup
config show
config path
config validate
models [SEARCH]
models --fresh [SEARCH]
```

## 21.6 Supervisor commands

```text
supervisor start
supervisor status
supervisor pause
supervisor resume
supervisor refresh
supervisor stop
```

## 21.7 Pool commands

```text
pool list
pool add MODEL_OR_INHERIT --workers N [--name ID]
pool scale ID N
pool model ID MODEL_OR_INHERIT
pool enable ID
pool disable ID
pool remove ID
```

`pool remove` affects future refill. Existing workers continue.

## 21.8 Worker commands

```text
worker list
worker history [--limit N]
worker show ID
worker stop ID
worker status --phase PHASE [--bead ID] [--message TEXT]
```

The `worker status` command is intended for managed workers and reads `PI_SWARM_SPAWN_ID` by default.

## 21.9 Coordinator and Enricher

```text
coordinator run [--model MODEL_OR_INHERIT]
bead enrich ID [--model MODEL_OR_INHERIT]
```

## 21.10 Diagnostics

```text
status
status --explain
doctor
doctor --live-agent-mail
logs
```

`doctor` reports rather than repairs.

## 21.11 Compatibility aliases

During V1 migration:

```text
spawn list       → worker list
spawn history    → worker history
spawn stop ID    → worker stop ID
```

The old task/message/reservation commands return a clear removal message:

```text
This fork uses br for work state and MCP Agent Mail for coordination.
See AGENTS.md and run: br ready --json
```

## 21.12 Error format

Human example:

```text
✗ Pool model is unavailable

Pool:  glm
Model: umans/glm-5.2

Pi does not report this exact model for the current user.
Authenticate/configure it in Pi or choose another model.

Run: pi-messenger-swarm models glm
```

JSON example:

```json
{
  "ok": false,
  "command": "pool model",
  "error": {
    "code": "MODEL_UNAVAILABLE",
    "message": "Pi does not report umans/glm-5.2",
    "hint": "Run pi-messenger-swarm models glm"
  }
}
```

---

# 22. Operator Overlay and UI/UX

## 22.1 Pi command

Replace the public `/messenger` workflow with:

```text
/swarm
```

A `/messenger` compatibility command may open `/swarm` with a deprecation notice during V1.

## 22.2 Screen model

```text
1 Overview
2 Workers
3 Pools
4 Activity
5 Diagnostics
```

The first V1 release is read-only. Mutations remain CLI-backed.

## 22.3 Overview

Show:

```text
project path
branch
supervisor enabled/paused/running
last and next tick
ready Bead count
running/maximum workers
pool summary
recent failures
why idle / why capped
```

## 22.4 Workers

Columns:

```text
NAME
POOL
BEAD
PHASE
MODEL
ELAPSED
TOKENS
STATUS
```

Detail pane:

```text
spawn ID
PID
session ID
requested model
actual model
current claimed Bead
current reported Bead
phase/status message
recent tools
start/end
exit/error
runtime mode: attached or detached
```

## 22.5 Pools

Columns:

```text
POOL
MODEL
TARGET
RUNNING
MISSING
AVAILABLE
ENABLED
```

Detail:

```text
role file
exact/inherit policy
configured count
running names
recent outcomes
model inventory status
```

## 22.6 Activity

Use the existing progress/live-worker machinery.

Show bounded recent events:

```text
worker spawned
worker reported Bead
phase update
worker exited
worker restored
supervisor tick
worker failure
coordinator/enricher run
```

Do not include Agent Mail message bodies.

## 22.7 Diagnostics

```text
Pi binary/version
model inventory age
AGENTS.md path
README path
br available
bv available
Agent Mail live probe result
branch
pre-commit guard unknown/detected
harness uptime/version
running restored PIDs
config path
last supervisor error
```

Optional ACFS command detection may show:

```text
dcg found/missing
ubs found/missing
rch found/missing
cass found/missing
cm found/missing
```

These are informational. `AGENTS.md` determines whether a tool is mandatory.

## 22.8 Responsive layouts

```text
compact   <72 columns
standard  72–119 columns
wide      ≥120 columns
```

Minimum target:

```text
40x18
```

## 22.9 Keyboard model

```text
1-5      switch screen
j/k      move selection
Enter    open detail
/        search/filter
r        refresh snapshot
?        help
Esc      close detail/search/help
q        close overlay
```

No screen assigns `r` a destructive or mutation meaning.

## 22.10 Search

Workers may be filtered by:

```text
name
pool
Bead ID
phase
model
status
```

## 22.11 Status symbols

Color is supplemental:

```text
● RUNNING
○ IDLE
! ATTENTION
✗ FAILED
■ STOPPED
↻ DETACHED
```

## 22.12 Empty and degraded states

Dedicated copy for:

```text
not configured
supervisor stopped
paused
no ready Beads
capacity full
all pools disabled
one pool model unavailable
br unavailable
Agent Mail not verified
no live workers
```

Example:

```text
NO READY BEADS

The supervisor is healthy and has 6 free worker slots, but br ready returned no work.
Existing in-progress Beads are unchanged.

Inspect:
  br list --status in_progress --json
  br coordination status --json
```

## 22.13 Golden viewport tests

Snapshot at:

```text
40x18
60x20
90x28
140x40
```

Every rendered line must fit the supplied visible width.

---

# 23. Detailed File-by-File Implementation Plan

## 23.1 `package.json`

### Keep

```text
single CLI entry
single Pi extension
TypeScript
Vitest
pnpm
current Pi dependencies
```

### Change

- Update description and keywords from messenger/task orchestration to Pi worker supervision.
- Add no new runtime dependency for V1.
- Keep `pi.extensions` and `pi.skills` packaging.
- Ensure new `agents/` files are included in package files.

### Do not add

```text
SQLite binding
MCP SDK
generic daemon framework
prompt UI library
Git library
```

## 23.2 `action-types.ts`

Remove or stop exposing fields used only by removed task/message actions after migration.

Add:

```ts
export interface MessengerActionParams {
  // existing generic fields ...

  model?: string;
  poolId?: string;
  beadId?: string;
  workers?: number;
  phase?: string;
  spawnId?: string;
  agentName?: string;
  enabled?: boolean;
  paused?: boolean;
}
```

New actions:

```text
supervisor.start
supervisor.status
supervisor.pause
supervisor.resume
supervisor.refresh
supervisor.stop
pool.list
pool.add
pool.scale
pool.model
pool.enable
pool.disable
pool.remove
worker.list
worker.history
worker.show
worker.stop
worker.status
models.list
coordinator.run
bead.enrich
```

Use explicit runtime validation in each handler. V1 does not add a generated action-registry framework.

## 23.3 `config.ts`

### Keep

- current source precedence;
- current `getAgentDir()` paths;
- no external schema dependency.

### Change

- add `supervisor` to `MessengerConfig`;
- normalize nested supervisor defaults;
- validate pool IDs/counts/model modes;
- expose `writeProjectConfigPatch()` for setup/pool commands;
- stop silently treating malformed project configuration as missing;
- preserve unrelated fields on write.

Suggested parser result:

```ts
interface JsonReadResult {
  kind: 'missing' | 'value' | 'error';
  value?: Record<string, unknown>;
  error?: string;
}
```

## 23.4 `harness/cli.ts`

### Fix spawn model parsing

```ts
const model = extractFlag(args, 'model');
```

Forward it in the spawn action.

### Add command groups

Implement the CLI grammar in Appendix A. Use Node's built-in `readline/promises`
for the interactive wizard; add no prompt-library dependency.

### Preserve

- current server health/version/start logic;
- current project-root resolution;
- existing JSON-action compatibility during migration.

### Simplify help

Remove task/channel examples from the default help.

## 23.5 `harness/server.ts`

### Keep

- detached loopback server;
- project cwd resolution;
- config cache;
- current spawn runtime restoration;
- `/health`, `/restart`, `/quit`;
- preserve-spawns shutdown behavior.

### Add

```ts
const supervisors = new Map<string, ProjectSupervisor>();
```

Functions:

```ts
ensureSupervisor(cwd: string): ProjectSupervisor;
startConfiguredSupervisor(cwd: string): void;
stopSupervisor(cwd: string): void;
```

On server startup:

```text
restore runtimes
reconcile orphans
load startup project config
start supervisor when enabled
```

On relevant actions, ensure the current project's supervisor exists.

### Do not add

- a new socket protocol;
- authentication tokens;
- a project database;
- multi-process project leadership.

Those are outside the proven-path V1.

## 23.6 `router.ts`

Remove routing for public task/message/reservation actions when their handlers are removed.

Add routing for supervisor, pool, worker-status, model, coordinator, and Enricher actions.

The existing `executeAction()` model remains.

## 23.7 `swarm/types.ts`

### Remove from supported exports

```text
SwarmTask
SwarmTaskStatus
SwarmTaskEvidence
SwarmTaskCreateInput
SwarmSummary
```

They may remain temporarily until task handlers/tests are deleted.

### Extend spawn types

Use the contracts from Sections 12 and 17.

## 23.8 `swarm/spawn.ts`

### Keep

- event paths;
- append/replay;
- generated agent files;
- skill discovery;
- Pi JSON event handling;
- runtime map;
- stop logic;
- PID persistence;
- restore/orphan recovery.

### Change

1. Replace the Pi Messenger operating protocol with the implementer role protocol.
2. Add request model support.
3. Remove `--no-session` for managed workers.
4. Add `--name`.
5. Add pool/Bead/status metadata.
6. Set `PI_SWARM_SPAWN_ID`, `PI_SWARM_POOL_ID`, and `AGENT_NAME`.
7. Capture actual model from progress.
8. Notify the project supervisor after terminal events.
9. Add `updateSpawnStatus()`.

### Preserve current model argument style

Do not replace the verified provider/model split with a guessed new style.

## 23.9 `swarm/agent-loader.ts`

Keep the simple frontmatter parser.

Rules:

```text
role supported
persona supported
objective supported
model supported for manual spawn
agent-file model ignored for managed pool workers
```

Shipped role files omit model.

## 23.10 `swarm/progress.ts`

Add:

```text
actualModel
lastEventAt
```

Keep current token and tool parsing.

Do not turn the progress parser into a Beads/Agent Mail parser.

## 23.11 `swarm/live-progress.ts`

Keep current callbacks and worker snapshots.

Extend displayed metadata with pool/current Bead/phase/model.

## 23.12 `swarm/handlers/spawn.ts`

### Remove

The internal-task guard that refuses unbound spawns when Pi Messenger ready tasks exist.

### Add

- pass `params.model` into `SpawnRequest`;
- pass `poolId` and `managedPoolWorker`;
- human text labels the spawn as a managed pool worker;
- preserve manual spawn behavior.

## 23.13 New `swarm/supervisor.ts`

Implement Section 11 exactly.

Dependencies:

```text
loadConfig
spawnSubagent
listSpawned
cleanup/reconcile functions
readReadyBeads
model inventory
```

No imports from Agent Mail or Git.

## 23.14 New `swarm/br-ready.ts`

Responsibilities:

```text
run br ready --json with RUST_LOG=error
bounded timeout
bounded stdout/stderr
normalize captured output shape
return ReadyBead[]
```

This module is read-only.

## 23.15 New `swarm/model-catalog.ts`

Responsibilities:

```text
spawn short-lived Pi RPC process
send get_available_models
parse correlated response
cache result and in-flight promise
support search/filter
return exact IDs for validation
```

## 23.16 New `swarm/worker-status.ts`

Validate `WorkerStatusUpdate` and call `updateSpawnStatus()`.

No task mutation.

## 23.17 `index.ts`

### Remove/disable

- messenger registration context;
- channel switching UI;
- message renderer;
- reservation enforcement for Pi Messenger's own reservation store;
- auto-register behavior tied to channels.

### Keep

- harness startup;
- shell alias installation;
- live worker callbacks;
- status rendering;
- Pi command registration;
- session-start/session-shutdown integration needed by the package.

### Add

```text
/swarm command
read-only dashboard
optional /swarm setup later
harness health check/restart on extension heartbeat
```

Spawned workers still load the extension because it provides the local worker-status CLI/harness integration. The extension must not inject messenger/task instructions.

## 23.18 `extension/harness.ts`

Keep current detached start and subagent reuse behavior.

Add optional health check:

```text
operator Pi status heartbeat
  → if harness health unavailable
  → call start()
```

Do not run this inside spawned workers.

## 23.19 `extension/shutdown.ts`

Keep behavior that does not kill the detached harness merely because one Pi session ends.

Supervisor lifecycle is independent of the operator Pi conversation while the harness remains alive.

## 23.20 `extension/reservation.ts`

Remove from the supported extension path after Pi Messenger reservation actions are removed.

Agent Mail and its pre-commit guard remain external.

## 23.21 `swarm/task-store.ts` and task handlers

Remove from the product surface.

Delete or archive only after owner-approved implementation Beads explicitly authorize removal. Until then:

```text
router cannot reach them
worker prompts cannot mention them
CLI help cannot advertise them
tests prove they are disabled
```

## 23.22 Feed/channel/message modules

Same migration rule:

```text
disable public routing first
rewrite overlay
remove imports
then remove dead files in an explicitly authorized cleanup Bead
```

## 23.23 `overlay/component.ts`

Reuse:

```text
Component
Focusable
matchesKey
visible-width truncation
render caching
responsive layout
selection/search patterns
```

Replace channel/task/feed rendering with screens in Section 22.

## 23.24 `overlay/config-overlay.ts`

V1 may keep configuration mutation in the CLI.

Replace the current messenger settings panel with a read-only configuration summary or defer interactive setup to V1.1.

## 23.25 `agents/implementer.md`

Add the role contract in Appendix C.

No model frontmatter.

## 23.26 `agents/coordinator.md`

Add the one-shot tender contract.

No model frontmatter.

## 23.27 `agents/bead-enricher.md`

Add the suggestion-only review contract.

No model frontmatter.

## 23.28 `skills/pi-swarm/SKILL.md`

Replace the messaging/task reference with:

```text
setup
supervisor/pool/worker commands
how model inheritance works
how worker telemetry differs from Beads
how to use coordinator/enricher
troubleshooting
```

Do not duplicate the full Agent Mail, Beads, `bv`, DCG, UBS, or RCH documentation already supplied by `AGENTS.md` and their installed skills.

---

# 24. Testing Strategy

## 24.1 Test layers

```text
unit
contract-fixture
integration with fake executables
harness restart/recovery
CLI golden
TUI golden
optional live local probes
```

## 24.2 Existing tests

Before modification:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Record baseline failures before changing code.

## 24.3 Fake Pi

A fake `pi` executable supports:

```text
JSON worker mode
RPC model-list mode
selected model echo
scripted tool events
scripted message_end events
controlled exit code
delayed exit
long-running process
```

Tests:

- exact model produces provider/model args;
- inherit produces no model args;
- `--no-session` absent for managed worker;
- `--name` present;
- role file appended;
- AGENTS context not disabled;
- actual model captured;
- token count preserved.

## 24.4 Fake `br`

Fixtures:

```text
ready list with N issues
empty ready list
malformed JSON
nonzero exit
slow command
issue removed between ticks
```

Tests:

- normalizer uses installed captured shape;
- no mutation commands executed by supervisor;
- ready count caps worker starts;
- current claimed Bead IDs are excluded;
- br outage reports degraded and starts none.

## 24.5 No fake Agent Mail client

The supervisor does not call Agent Mail, so no Agent Mail adapter test suite is required.

Test instead:

- role prompt contains Agent Mail startup expectations;
- live probe worker can detect tools in an opted-in local test;
- no message body/token is persisted by the fork;
- old Pi Messenger send/reserve routes are disabled.

## 24.6 Pool tests

Cases:

```text
one inherit pool
two exact pools
one exact pool unavailable
pool target zero
disabled pool
sum targets below global max
sum targets above global max
round-robin fill under cap
scale up
scale down without killing workers
remove pool with active workers
```

## 24.7 Supervisor tests

- Disabled supervisor spawns nothing.
- Paused supervisor spawns nothing.
- No ready Beads spawns nothing.
- Ready count smaller than free capacity limits starts.
- `maxStartsPerTick` is respected.
- Worker close requests another tick.
- Concurrent tick requests coalesce.
- One pool error does not block another available pool.
- Existing restored workers count toward pool/global occupancy.
- New selectors never exceed visible ready-work demand after pending selectors are counted.

## 24.8 Runtime recovery tests

Use the existing recovery tests and add pool metadata:

```text
clean preserve-spawns restart
crash with live PID and no spawn-runtimes file
crash with dead PID
restored detached worker counted in pool
restored detached worker stops correctly
supervisor refills only missing slots after recovery
```

## 24.9 Worker status tests

- Spawned worker updates its own phase using env spawn ID.
- Human explicit spawn ID works.
- Wrong cwd/unknown ID is rejected.
- Status failure does not alter `br` or process state.
- Status update persists as a progress event.
- Status survives harness restart through replay.

## 24.10 CLI golden tests

```text
no arguments
setup preview
model unavailable
supervisor status: running
supervisor status: no ready Beads
pool list
worker list
worker show
legacy task command removal message
legacy send command removal message
```

Test TTY/plain/JSON/NO_COLOR.

## 24.11 Overlay golden tests

For each viewport:

```text
not configured
stopped
healthy two-pool
capacity capped
no ready Beads
one unavailable model
running workers
failed/restored workers
worker detail
pool detail
diagnostics
```

## 24.12 Role prompt tests

Assert implementer prompt contains:

```text
read AGENTS.md first
read README.md
register/check Agent Mail
claim with br
use bv when needed
reserve exact paths
one Bead only
follow AGENTS.md for tests/Git/completion
exit after completion
```

Assert absent:

```text
pi-messenger-swarm task
pi-messenger-swarm feed
pi-messenger-swarm send
Pi Messenger reserve/release
worktree
custom landing lane
supervisor-owned br close
```

## 24.13 Live local checks

Opt-in only:

```text
Pi model catalog
one harmless Pi JSON spawn
br ready JSON fixture capture
bv robot output smoke test
Agent Mail tool visibility probe
pre-commit guard presence
```

Do not modify real Beads or mailbox state without an explicitly selected test project.

## 24.14 Soak test

Run a fake-runtime soak:

```text
2 pools
10 target workers
4 global maximum
hundreds of worker exits
periodic harness restart
random fake br ready counts
model pool temporary unavailability
status/overlay polling
```

Verify bounded memory and correct occupancy/refill.

---

# 25. Implementation Phases

## Phase 0 — Pin and capture the actual environment

### Work

- Preserve the upstream commit and V11 plan snapshot.
- Run upstream install/typecheck/test/build.
- Capture current local Pi version and model RPC fixture.
- Capture local `br ready --json` fixture.
- Capture local `bv --robot-triage` smoke output.
- Verify project AGENTS.md and README paths.
- Verify Agent Mail visibility inside a spawned Pi probe.
- Record current branch and pre-commit guard status.

### Exit gate

No command/output shape used by implementation remains guessed.

## Phase 1 — Remove duplicate public coordination surfaces

### Work

- Rewrite help and skill documentation.
- Disable task routes.
- Disable channel/feed/send routes.
- Disable Pi Messenger reservation routes.
- Remove task/feed/channel requirements from generated worker prompts.
- Keep spawn/list/history/stop working.

### Exit gate

A manual spawn can run without any Pi Messenger task/message/reservation command.

## Phase 2 — Fix model wiring and saved Pi sessions

### Work

- Add `model` to `SpawnRequest`.
- Parse `--model` in CLI.
- Forward model through handler.
- Implement requested-model precedence.
- Remove `--no-session` for managed workers.
- Add Pi `--name`.
- Capture actual model.
- Add pool/Bead fields to spawn records.

### Exit gate

Manual exact-model and inherit spawns work, sessions save normally, and history shows requested/actual models.

## Phase 3 — Add model discovery and setup

### Work

- Implement minimal Pi RPC model probe.
- Add cached inventory.
- Extend configuration.
- Add interactive and non-interactive setup.
- Add pool commands.
- Add config validation and safe project write.

### Exit gate

The owner's example allocation can be entered in one command when those exact models are visible, and invalid models are rejected before config write.

## Phase 4 — Add one-pool continuous supervisor

### Work

- Implement read-only `br ready` client.
- Add `ProjectSupervisor` timer and coalesced tick.
- Start configured supervisor with harness.
- Refill one pool.
- Respect ready count, pending selectors, global limit, and starts-per-tick.
- Add the no-claim selection backoff.
- Trigger refill after worker exit.
- Add supervisor CLI/status reasons.

### Exit gate

One pool continuously replaces one-Bead workers while ready Beads exist.

### Release

May ship as `0.1 Worker Pool Preview`.

## Phase 5 — Add multiple pools and worker telemetry

### Work

- Add deterministic round-robin pool allocation.
- Add worker status action.
- Add current Bead/phase/Agent Mail name telemetry.
- Reconstruct pool occupancy after harness restart.
- Handle pool enable/disable/scale/remove.
- Add unavailable-model per-pool behavior.

### Exit gate

Two pools maintain the configured mix under a global cap and recover correctly after harness replacement.

### Release

May ship as `0.2 Multi-Pool Preview`.

## Phase 6 — Replace the overlay

### Work

- Add `/swarm`.
- Implement Overview, Workers, Pools, Activity, Diagnostics.
- Add responsive layouts and accessibility.
- Add clear empty/degraded states.
- Add UI golden tests.

### Exit gate

The dashboard accurately reflects the same state as CLI JSON.

## Phase 7 — Add optional coordinator and Bead Enricher

### Work

- Add role files.
- Add manual coordinator command.
- Add optional interval coordinator trigger.
- Add manual suggestion-only Enricher command.
- Add role prompt tests.
- Ensure neither feature is required for refill.

### Exit gate

Coordinator/Enricher can be completely disabled without changing worker operation.

### Release

May ship as `0.3 Tending Preview`.

## Phase 8 — Cleanup, soak, packaging, documentation

### Work

- Remove unreachable legacy files after explicit owner-approved cleanup Beads.
- Update README and CHANGELOG.
- Add migration notes.
- Run fake-runtime soak.
- Audit package contents.
- Test install from tarball/git.
- Run optional live local probes.

### Exit gate

All V1 criteria pass and no disabled legacy route is reachable.

---

# 26. Release Gates and Acceptance Criteria

## 26.1 Baseline

- [ ] Pinned upstream build passes or baseline failures are documented.
- [ ] Local Pi version and model fixture captured.
- [ ] Local `br` fixture captured.
- [ ] Project AGENTS.md found.

## 26.2 Authority boundaries

- [ ] No custom task database is reachable.
- [ ] No custom messaging surface is reachable.
- [ ] No Pi Messenger reservation surface is reachable.
- [ ] Supervisor uses `br` read-only.
- [ ] Workers use Agent Mail directly.
- [ ] Workers own Git/Beads lifecycle according to AGENTS.md.

## 26.3 Pi

- [ ] Inherit passes no model override.
- [ ] Exact model uses verified upstream provider/model argument style.
- [ ] Shipped role files have no model default.
- [ ] Managed workers save Pi sessions.
- [ ] Context files remain enabled.
- [ ] Actual model captured when Pi emits it.

## 26.4 Pools

- [ ] Setup supports repeatable `--worker MODEL=COUNT`.
- [ ] Exact models validated through Pi.
- [ ] Global maximum enforced and revalidated immediately before spawn.
- [ ] Targets may exceed global maximum.
- [ ] Round-robin refill deterministic.
- [ ] Unavailable model blocks only its pool.
- [ ] Scale-down does not kill active workers.

## 26.5 Supervisor

- [ ] Disabled/paused means no starts.
- [ ] No ready Beads means no starts.
- [ ] Ready count bounds starts.
- [ ] Pending selectors subtract from visible ready-work demand.
- [ ] No-claim exits trigger a bounded selection backoff.
- [ ] Starts staggered.
- [ ] Worker terminal event triggers refill.
- [ ] No same-Bead automatic retry/reclaim.

## 26.6 AGENTS.md

- [ ] Unattended start requires AGENTS.md.
- [ ] Worker first action says read full AGENTS.md and README.
- [ ] Post-compaction reread instruction present.
- [ ] ACFS tool behavior is delegated to AGENTS.md, not duplicated in supervisor code.

## 26.7 Recovery

- [ ] Clean harness replacement preserves workers.
- [ ] Crash orphan recovery restores live PIDs.
- [ ] Dead PID becomes failed.
- [ ] Restored pool occupancy prevents duplicate refill.
- [ ] Detached status clearly says live output unavailable.

## 26.8 UI/CLI

- [ ] Bare invocation quick start.
- [ ] Human/plain/JSON outputs tested.
- [ ] `/swarm` works at target widths.
- [ ] Why-idle/capped reasons visible.
- [ ] No Agent Mail message body displayed or persisted.

## 26.9 Optional roles

- [ ] Coordinator disabled by default.
- [ ] Enricher disabled by default.
- [ ] Coordinator does not gate refill.
- [ ] Enricher does not edit source or claim/close work.

---

# 27. Risk Analysis

| Risk | Mitigation | Residual truth |
|---|---|---|
| Two workers prefer the same Bead | Staggered starts, pending-selector accounting, atomic `br --claim`, then refresh and choose another Bead | A claim conflict can still spend one model turn; it cannot authorize duplicate edits. |
| Workers repeatedly find no claimable work | Pending-selector accounting and a short no-claim backoff | Backoff is process-local and may reset after harness restart. |
| Shared-main workers touch the same file | Agent Mail reservations, thread communication, pre-commit guard, AGENTS.md, exact staging | Reservations are advisory; no filesystem isolation exists. |
| Worker ignores AGENTS.md | Pi context loading plus explicit first-action prompt | The fork cannot prove model comprehension. |
| Harness crashes | Existing PID persistence/orphan recovery; saved Pi sessions | Live stdout pipes cannot be recovered. |
| PID reused | Conservative display and current upstream behavior | V1 does not provide strong PID identity. |
| Worker exits with Bead still in progress | Attention display; coordinator/operator inspects `br coordination status` and Agent Mail | No automatic reclaim. |
| Model disappears after setup | Per-pool availability check; pool blocked; other pools continue | Active workers remain on the model with which they started. |
| Agent Mail unavailable | Worker reports failure/block; supervisor continues only as configured | Supervisor does not independently verify reservations. |
| Malformed project config | Fail with path/error instead of silently ignoring | Full schema migration framework is not included. |
| Too many simultaneous starts | Global limit and `maxStartsPerTick` | Provider-specific rate limits remain Pi/provider concerns. |
| Git commit collision | Existing shared-main workflow, small commits, pre-commit guard, communication | The supervisor does not serialize Git. |
| No ready work | Supervisor idles and explains why | It does not create new work automatically. |
| Coordinator becomes bottleneck | Optional, one-shot, never required | It can still produce poor advice; it has no authority. |
| Enricher damages intent | Suggestion/comment only by default | Human judgment remains necessary for substantive rewrites. |
| Legacy modules linger | Disable routing first, delete through explicit cleanup Beads | Package may carry dead code during previews. |

---

# 28. Phase 0 Local Contract Capture

The following are local facts, not architecture assumptions.

## 28.1 Pi

Capture:

```text
pi real path
pi version
get_available_models response
provider/model argument behavior
JSON event types used by progress parser
project trust behavior
session file creation after removing --no-session
Agent Mail tool visibility in spawned Pi
```

## 28.2 `br`

Capture:

```text
br real path/version
br ready --json exact shape
br show --json exact shape
atomic claim syntax used by current installation
actor environment/flag convention
coordination status availability
```

## 28.3 `bv`

Capture:

```text
bv real path/version
bv --robot-triage smoke output
bv --robot-next smoke output
```

The supervisor does not parse these outputs in V1, but workers depend on them.

## 28.4 Agent Mail

Capture through Pi:

```text
installed MCP adapter
server/tool visibility
project key convention
requested-name behavior
reservation and message tool names
pre-commit guard status
```

The fork does not store auth tokens or implement the client.

## 28.5 Project

Capture:

```text
canonical project root
AGENTS.md path
README path
main branch status
remote/push expectations
working-tree status
.pi/pi-messenger.json status
.beads presence
```

## 28.6 ACFS tool visibility

Informational:

```text
dcg
ubs
rch
cass
cm
slb
acfs doctor
```

The worker follows `AGENTS.md`; setup does not invent requirements absent from that file.

## 28.7 Contract artifact

Write:

```text
docs/LOCAL_COMPATIBILITY.md
```

It records versions and shapes without secrets.

---

# 29. Post-V1 Roadmap

Only evaluate these after V1 usage:

## 29.1 Multi-project persistent supervisors

Persist and restore several project supervisor registrations across harness restarts.

## 29.2 Stronger process identity and file-backed live logs

Add only if PID ambiguity or lost progress is operationally significant.

## 29.3 Automatic stale-claim assistance

May generate a review report, but any reclaim remains evidence-driven and operator-controlled.

## 29.4 Active coordinator routing

Enable only if one-shot coordinator experiments measurably improve throughput over direct `br ready` plus worker `bv` usage.

## 29.5 Batch Bead enrichment

Run bounded suggestion passes over several ready Beads.

## 29.6 Optional worktree mode

Requires a separate architecture and integration plan.

## 29.7 Rich mutation-capable overlay

Add only after CLI actions and config behavior are stable.

---

# Appendix A: Complete CLI Grammar

The grammar below is the complete V1 human-facing command surface. Commands not listed here are either compatibility aliases or removed legacy surfaces.

```text
pi-messenger-swarm [GLOBAL_FLAGS] [COMMAND]

GLOBAL_FLAGS
  --json
  --plain
  --quiet
  --debug
  --no-color
  --help
  --version

SETUP AND CONFIGURATION
  setup
    [--worker MODEL_OR_INHERIT=COUNT]...
    [--coordinator MODEL_OR_INHERIT]
    [--no-coordinator]
    [--max-concurrent N]
    [--poll-seconds N]
    [--max-starts-per-tick N]
    [--start]
    [--dry-run]
    [--json]

  config show
  config path
  config validate

MODELS
  models [SEARCH]
  models --fresh [SEARCH]

SUPERVISOR
  supervisor start
  supervisor status
  supervisor pause
  supervisor resume
  supervisor refresh
  supervisor stop

POOLS
  pool list
  pool add MODEL_OR_INHERIT --workers N [--name ID]
  pool scale ID N
  pool model ID MODEL_OR_INHERIT
  pool enable ID
  pool disable ID
  pool remove ID

WORKERS
  worker list
  worker history [--limit N]
  worker show ID
  worker stop ID
  worker status
    [--spawn-id ID]
    --phase PHASE
    [--bead ID]
    [--message TEXT]
    [--agent-name NAME]

OPTIONAL ROLES
  coordinator run [--model MODEL_OR_INHERIT]
  bead enrich ID [--model MODEL_OR_INHERIT] [--comment]

DIAGNOSTICS
  status [--explain]
  doctor [--live-agent-mail]
  logs

HARNESS COMPATIBILITY
  --status
  --start
  --stop
  --restart
  --logs

SPAWN COMPATIBILITY
  spawn [--role ROLE] [--model MODEL] [--agent-file PATH]
        [--objective TEXT] [--context TEXT] [--message-file PATH]
        [--name NAME] [--force] [MISSION]
  spawn list
  spawn history
  spawn stop ID
```

## A.1 Removed legacy surfaces

The following commands are not part of the fork's V1 product:

```text
join
send
feed
channels
reserve
release
set-status
rename
swarm

task list
 task ready
 task show
 task create
 task claim
 task unclaim
 task progress
 task done
 task block
 task unblock
 task reset
 task archive-done
```

During migration, invoking one returns exit code `2` with a concise replacement message:

```text
This command is not used by the Pi worker-pool fork.

Work state:        br
Work intelligence: bv --robot-*
Coordination:      MCP Agent Mail
Project rules:     AGENTS.md
```

## A.2 Exit codes

```text
0  success
1  operational failure
2  usage/configuration/removed-command error
3  dependency unavailable or unsupported contract
```

## A.3 JSON output

Every ordinary command invoked with `--json` prints exactly one object:

```json
{
  "ok": true,
  "command": "worker list",
  "project": "/absolute/project/path",
  "data": {}
}
```

No diagnostic prose is written to stdout in JSON mode. Diagnostics go to stderr.

---

# Appendix B: Complete Configuration Example

V1 extends the existing `.pi/pi-messenger.json` file rather than introducing another project configuration authority.

```json
{
  "maxConcurrentSpawns": 10,
  "nameTheme": "default",
  "autoOverlay": true,
  "supervisor": {
    "enabled": true,
    "paused": false,
    "pollIntervalMs": 15000,
    "maxStartsPerTick": 2,
    "projectTrust": "inherit",
    "workerPools": [
      {
        "id": "primary",
        "workers": 6,
        "enabled": true,
        "model": {
          "mode": "exact",
          "model": "provider/model"
        },
        "roleFile": "agents/implementer.md"
      },
      {
        "id": "glm",
        "workers": 4,
        "enabled": true,
        "model": {
          "mode": "exact",
          "model": "umans/glm-5.2"
        },
        "roleFile": "agents/implementer.md"
      }
    ],
    "coordinator": {
      "enabled": true,
      "mode": "manual",
      "model": {
        "mode": "exact",
        "model": "openai-codex/sol"
      },
      "roleFile": "agents/coordinator.md"
    },
    "beadEnricher": {
      "enabled": false,
      "mode": "manual",
      "model": {
        "mode": "inherit"
      },
      "roleFile": "agents/bead-enricher.md"
    }
  }
}
```

The example model IDs are owner-supplied examples. Setup must reject them when Pi does not report exact matches for the current user.

## B.1 Minimal inherited-model configuration

```json
{
  "maxConcurrentSpawns": 4,
  "supervisor": {
    "enabled": true,
    "paused": false,
    "pollIntervalMs": 15000,
    "maxStartsPerTick": 2,
    "projectTrust": "inherit",
    "workerPools": [
      {
        "id": "default",
        "workers": 4,
        "enabled": true,
        "model": {
          "mode": "inherit"
        },
        "roleFile": "agents/implementer.md"
      }
    ],
    "coordinator": {
      "enabled": false,
      "mode": "manual",
      "model": {
        "mode": "inherit"
      }
    },
    "beadEnricher": {
      "enabled": false,
      "mode": "manual",
      "model": {
        "mode": "inherit"
      }
    }
  }
}
```

## B.2 Normalized configuration contract

```ts
export type ProjectTrustMode =
  | 'inherit'
  | 'approve-for-this-spawn'
  | 'no-approve-for-this-spawn';

export type PiModelSelection =
  | { mode: 'inherit' }
  | { mode: 'exact'; model: string };

export interface WorkerPoolConfig {
  id: string;
  workers: number;
  enabled: boolean;
  model: PiModelSelection;
  roleFile?: string;
}

export interface SupervisorConfig {
  enabled: boolean;
  paused: boolean;
  pollIntervalMs: number;
  maxStartsPerTick: number;
  projectTrust: ProjectTrustMode;
  workerPools: WorkerPoolConfig[];
  coordinator: {
    enabled: boolean;
    mode: 'manual' | 'interval';
    intervalMinutes?: number;
    model: PiModelSelection;
    roleFile?: string;
  };
  beadEnricher: {
    enabled: boolean;
    mode: 'manual';
    model: PiModelSelection;
    roleFile?: string;
  };
}
```

## B.3 Validation table

| Field | Rule |
|---|---|
| `maxConcurrentSpawns` | integer `1..128` |
| `pollIntervalMs` | integer `5_000..300_000` |
| `maxStartsPerTick` | integer `1..32`, not greater than global maximum |
| pool ID | unique and matches `[A-Za-z0-9._-]+` |
| pool workers | integer `0..64` |
| exact model | exact ID found in a fresh Pi model inventory during setup |
| role file | resolves to a readable regular file |
| coordinator interval | required and positive only in interval mode |
| project config JSON | malformed JSON fails; it never silently falls back |

---

# Appendix C: Shipped Role Files

These files are narrow additions to the context Pi already receives from the project's `AGENTS.md`. They contain no provider or model defaults.

## C.1 `agents/implementer.md`

```markdown
---
role: Pi Flywheel Implementer
---

# Pi Flywheel Implementer

You are one fungible implementation worker in a shared Agent Flywheel checkout.
Complete one Bead, then exit.

## Startup — do this before anything else

1. Read all of the project's `AGENTS.md` and `README.md` carefully.
2. Follow those files as the authoritative rules for safety, tools, tests, Git,
   Beads, Agent Mail, DCG, UBS, RCH, and completion.
3. Run `pi-messenger-swarm worker status --phase reading_rules` as best-effort
   telemetry. A telemetry failure does not block the real work.
4. Register or resume your MCP Agent Mail identity. Request `PI_AGENT_NAME` when
   the installed Agent Mail tool supports a requested name.
5. Check your inbox and active agents before choosing or claiming work.

## Work selection

- Use `bv --robot-triage`, `bv --robot-next`, and `br ready` to choose one useful
  ready Bead.
- Claim it atomically through the installed `br` workflow before editing.
- If the claim fails, do not edit; refresh the work frontier and choose another.
- The supervisor supplies process capacity, not task ownership.

## Coordination

- Use the Bead ID as the Agent Mail thread ID, subject prefix, reservation reason,
  and commit reference.
- Reserve the smallest practical path set before editing.
- Treat reservation conflicts as a coordination signal. Contact the owner, wait,
  narrow the edit surface, or choose another Bead.
- Other agents' unrelated changes are expected. Never stash, reset, restore,
  overwrite, format, stage, or commit their paths.

## Implementation

- Work only on one claimed Bead.
- Follow `AGENTS.md`; do not substitute generic commands for project commands.
- Send material progress through the Bead's Agent Mail thread.
- Update local worker telemetry at major phases when convenient:
  `coordinating`, `claiming`, `implementing`, `testing`, `reviewing`,
  `committing`, `finishing`, or `blocked`.

## Completion

- Run every check required by `AGENTS.md`.
- Perform the required self-review, UBS/RCH/DCG steps, Git commit/push, Beads
  update/close/sync, reservation release, and Agent Mail handoff exactly as the
  project contract requires.
- If blocked, record the reason in Beads and Agent Mail as the project workflow
  requires; do not pretend the work completed.
- Exit after the one-Bead workflow reaches its legitimate terminal point.

After any context compaction, reread the root `AGENTS.md` before continuing.
```

## C.2 `agents/coordinator.md`

```markdown
---
role: Pi Flywheel Coordinator Tender
---

# Pi Flywheel Coordinator Tender

You perform one bounded tending pass and then exit.

1. Read `AGENTS.md` and `README.md` first.
2. Do not implement product code and do not claim an implementation Bead.
3. Inspect the current worker list, failed/detached workers, `br ready`,
   `br list --status in_progress`, relevant `bv --robot-*` output, and Agent Mail.
4. Look for unanswered requests, stale-looking work, missing coordination,
   overlapping reservations, unclear Beads, and ready work that would unblock
   the project.
5. Send concise, targeted Agent Mail messages when a worker needs coordination.
6. Never reclaim or reset a Bead without the evidence and authorization required
   by `AGENTS.md` and the installed Beads workflow.
7. Return a concise operator report. Do not alter pool configuration or start/stop
   workers unless the operator explicitly asked this run to do so.
8. Exit.
```

## C.3 `agents/bead-enricher.md`

```markdown
---
role: Bead Enricher
---

# Bead Enricher

Review one existing Bead and then exit.

1. Read `AGENTS.md`, `README.md`, the target Bead, its dependencies/comments, and
   only the relevant project-plan sections.
2. Do not edit source files.
3. Do not claim, close, reopen, reassign, delete, or reprioritize the Bead.
4. Check description clarity, acceptance criteria, tests, dependencies, duplicate
   or overlapping work, plan references, and likely file surface.
5. Prefer a review comment that preserves owner-authored fields.
6. For substantive changes, print exact proposed `br` commands for operator review;
   do not run them automatically.
7. When `--comment` was explicitly requested, add one bounded review comment and
   make no other Beads mutation.
8. Exit.
```

## C.4 Worker mission template

The supervisor sends a short first user mission. It does not copy the complete Bead body or project rule file.

```text
You are ${workerName}, a managed Pi worker in pool ${poolId}.

First read all of AGENTS.md and README.md. Then follow the complete implementer
role and the project's existing Agent Flywheel workflow. Use bv and br to select
and atomically claim one ready Bead before editing. Complete that one Bead, follow
AGENTS.md for all checks/coordination/Git/Beads steps, release reservations, and
exit.
```

---

# Appendix D: Runtime State and Refill State Machines

The state machines below describe only local process supervision. They do not replace Beads or Agent Mail state.

## D.1 Supervisor state

```text
STOPPED
  supervisor start
    ↓
RUNNING
  no ready work / full / dependency error
    ↺ remain RUNNING with reason
  supervisor pause
    ↓
PAUSED
  supervisor resume
    ↓
RUNNING
  supervisor stop
    ↓
STOPPED
```

`supervisor stop` stops replenishment. It does not automatically terminate existing workers.

## D.2 Worker process state

```text
SPAWNING
  Pi process created
    ↓
RUNNING
  worker status/progress events
    ↺ RUNNING
  process exits 0
    ↓
COMPLETED
  process exits nonzero
    ↓
FAILED
  operator stop
    ↓
STOPPED
```

The local state does not assert that `COMPLETED` means the Bead is closed. Beads remains the source of truth.

## D.3 Refill cycle

```text
TICK REQUESTED
  ↓
coalesce with active tick when necessary
  ↓
reconcile upstream spawn records and PIDs
  ↓
load strict project config
  ↓
if disabled/paused → record reason and stop tick
  ↓
calculate global free process slots
  ↓
if none → capacity_full
  ↓
read `br ready --json`
  ↓
subtract live managed workers that have not yet reported a claimed Bead
  ↓
calculate missing pool slots
  ↓
round-robin enabled/available pools under global cap
  ↓
start at most maxStartsPerTick generic one-Bead selectors
  ↓
record tick summary
```

## D.4 Failure and replacement

```text
worker fails
  ↓
existing spawn close handler records FAILED
  ↓
supervisor receives terminal callback or next timer fires
  ↓
pool occupancy decreases
  ↓
current `br ready` is read
  ↓
fresh worker starts only for currently ready work
```

The failed Bead is not force-reset or automatically reclaimed.

## D.5 Harness replacement

```text
old harness receives preserve-spawns shutdown
  ↓
writes spawn-runtimes.json
  ↓
workers keep running
  ↓
new harness starts
  ↓
restoreRuntimes()
  ↓
reconcileAndRestoreOrphans()
  ↓
start configured supervisor
  ↓
refill uses restored occupancy
```

## D.6 Harness crash

```text
harness disappears without runtime snapshot
  ↓
workers may continue
  ↓
next harness startup scans spawned-agent JSONL
  ↓
live PID → detached runtime
  dead PID → failed tombstone
  ↓
supervisor restarts from reconstructed occupancy
```

---

# Appendix E: Source-to-Target File Map

| Current file or module | V1 treatment | Target responsibility |
|---|---|---|
| `package.json` | edit | Updated description/package contents; no new runtime dependency |
| `action-types.ts` | edit | Add pool/supervisor/worker/model fields and actions |
| `config.ts` | edit | Strict existing-file parsing plus nested supervisor configuration |
| `harness/cli.ts` | major edit | Fix `--model`; add setup/pool/supervisor/worker/model commands; remove legacy help |
| `harness/server.ts` | bounded edit | Host per-project supervisor instances; keep HTTP/restart/runtime restoration |
| `router.ts` | edit | Disable legacy coordination/task routes; route new worker-pool actions |
| `swarm/types.ts` | edit | Add model/pool/Bead/telemetry metadata; retire task types |
| `swarm/spawn.ts` | major edit | Replace worker protocol; saved sessions; model forwarding; pool metadata; terminal callbacks |
| `swarm/handlers/spawn.ts` | edit | Remove internal-task coupling; pass model/pool/Bead |
| `swarm/agent-loader.ts` | keep with tests | Manual-spawn frontmatter; shipped roles omit models |
| `swarm/progress.ts` | small edit | Capture actual model and last event time |
| `swarm/live-progress.ts` | edit | Include pool, Bead, phase, requested/actual model |
| `swarm/supervisor.ts` | new | Timer, read-only ready query, pool refill, idle reasons |
| `swarm/br-ready.ts` | new | Bounded `br ready --json` execution and captured-shape normalization |
| `swarm/model-catalog.ts` | new | Minimal Pi RPC model query with TTL/in-flight cache |
| `swarm/worker-status.ts` | new | Best-effort local spawn telemetry update |
| `index.ts` | major edit | `/swarm` dashboard; remove messenger context/renderer/reservation coupling |
| `extension/harness.ts` | small edit | Preserve detached harness; optional health restart from operator process |
| `extension/shutdown.ts` | keep | Do not tie harness lifetime to one Pi session |
| `extension/reservation.ts` | disable/remove later | Pi Messenger reservations are no longer a supported authority |
| `swarm/task-store.ts` | disable/remove later | `br` owns work state |
| `swarm/handlers/task*.ts` | disable/remove later | No custom task API |
| feed/channel/send handlers | disable/remove later | Agent Mail owns communication |
| `overlay/component.ts` | major rewrite | Overview, Workers, Pools, Activity, Diagnostics |
| `overlay/config-overlay.ts` | simplify | Read-only summary or deferred setup UI |
| `agents/implementer.md` | new | One-Bead Agent Flywheel worker contract |
| `agents/coordinator.md` | new | One-shot tending contract |
| `agents/bead-enricher.md` | new | Suggestion/comment-only Bead review |
| `skills/pi-swarm/SKILL.md` | new/replace | Supervisor CLI and troubleshooting only |
| current spawned-agent JSONL | retain | Process/runtime history |
| `spawn-runtimes.json` | retain | Clean restart PID restoration |

## E.1 No-new-runtime-dependency check

The V1 production dependency graph must not add a database, MCP SDK, Git SDK, daemon framework, scheduler framework, or prompt library. Node built-ins and the package's existing Pi dependencies are sufficient for the planned changes.

---

# Appendix F: Final Release Checklist

## F.1 Baseline preservation

- [ ] Fork pinned at the reviewed upstream commit before implementation starts.
- [ ] Existing upstream build, typecheck, and tests pass before changes.
- [ ] One manual upstream spawn still works in the baseline fixture.
- [ ] Existing clean-restart and orphan-recovery tests are captured.
- [ ] V11 is preserved as a snapshot; V12 is the current plan.

## F.2 Removed duplicate authorities

- [ ] Default CLI help contains no task/channel/feed/reservation workflow.
- [ ] Managed worker prompts contain no Pi Messenger task/message/reservation commands.
- [ ] Public legacy routes are unreachable or return the documented removal response.
- [ ] No replacement task, mailbox, or reservation database exists.
- [ ] `br`, `bv`, and Agent Mail remain direct worker tools.

## F.3 Pi and models

- [ ] Managed workers use Pi only.
- [ ] `--model` works from natural CLI through actual Pi arguments.
- [ ] Exact `provider/model` uses the upstream provider/model argument split.
- [ ] `inherit` passes no provider/model override.
- [ ] Setup obtains model inventory through Pi's supported RPC command.
- [ ] Exact unavailable model blocks only its configured pool.
- [ ] Model-catalog failure does not block an inherit pool.
- [ ] Shipped role files contain no model default.
- [ ] Requested and actual model are both visible when Pi reports the actual model.
- [ ] Pi credentials and model-auth files are never read or persisted by the fork.

## F.4 `AGENTS.md`

- [ ] Every managed Pi process starts in the actual project cwd.
- [ ] Context-file loading remains enabled.
- [ ] Worker mission makes reading `AGENTS.md` and `README.md` the first action.
- [ ] Missing `AGENTS.md` blocks unattended supervisor start by default.
- [ ] Role prompt requires rereading `AGENTS.md` after compaction.
- [ ] The fork does not duplicate DCG, UBS, RCH, testing, or Git rules already in the project contract.

## F.5 Supervisor and pools

- [ ] One-pool supervisor continuously replenishes workers while ready Beads exist.
- [ ] Multiple pools respect target counts and global `maxConcurrentSpawns`.
- [ ] Pool targets may exceed the global cap without changing that cap.
- [ ] Refill order is deterministic round-robin.
- [ ] At most `maxStartsPerTick` workers start per tick.
- [ ] Pending selectors are counted so new selectors do not exceed visible ready-work demand.
- [ ] Repeated no-claim exits cannot create an immediate spawn loop.
- [ ] Manual spawn/config changes during a `br` read cannot cause stale-capacity overfill.
- [ ] Supervisor uses `br` read-only.
- [ ] No automatic same-Bead retry, reset, force claim, or reclaim exists.
- [ ] Pause, resume, refresh, and stop have the documented semantics.

## F.6 Worker workflow

- [ ] Supervisor prompts workers to self-select and atomically claim through the established workflow.
- [ ] Worker claims through installed `br` before editing.
- [ ] Worker registers/checks Agent Mail and reserves paths according to `AGENTS.md`.
- [ ] Worker uses only `bv --robot-*` flags.
- [ ] Worker completes one Bead and exits.
- [ ] Worker owns normal Git and Beads completion actions; supervisor does not create a landing service.
- [ ] Unrelated shared-checkout changes are left untouched.

## F.7 Durability and recovery

- [ ] Managed workers save normal Pi sessions.
- [ ] Existing spawn JSONL remains the runtime history.
- [ ] Pool/Bead/model/phase metadata survives clean harness replacement.
- [ ] Clean harness replacement restores live occupancy.
- [ ] Crash startup restores live orphan PIDs and tombstones dead ones.
- [ ] Detached workers display that live output is unavailable.
- [ ] Supervisor restart does not duplicate restored workers merely because their pipes are gone.
- [ ] Documented limitations—PID reuse, lost pipes, no boot service, no exactly-once Bead execution—remain visible.

## F.8 CLI and UI

- [ ] Bare CLI prints quick start and exits zero.
- [ ] Human and JSON outputs are deterministic and tested.
- [ ] Overview explains why refill is idle or degraded.
- [ ] Workers screen distinguishes requested and actual model.
- [ ] Pools screen shows target, running, missing, availability, and status.
- [ ] Activity screen is based on existing spawn events.
- [ ] Diagnostics shows Pi, `br`, `bv`, Agent Mail probe state, AGENTS.md, branch, and harness state.
- [ ] All rendered lines fit `40x18`, `60x20`, `90x28`, and `140x40` fixtures.
- [ ] Color is never the only status signal.

## F.9 Optional roles

- [ ] Coordinator is disabled by default and one-shot when invoked.
- [ ] Coordinator does not claim or implement a Bead.
- [ ] Coordinator failure does not pause refill.
- [ ] Bead Enricher is disabled by default.
- [ ] Enricher does not edit source or mutate lifecycle/ownership.
- [ ] Enricher comment mutation occurs only with explicit operator request.
- [ ] No batch enrichment or active coordinator dispatch is required for V1.

## F.10 Testing and release

- [ ] Fake Pi covers inherit model, exact model, events, delayed exit, malformed line, and failure.
- [ ] Fake `br` covers ready, empty, malformed, timeout, and nonzero exit.
- [ ] Pool/refill property tests never exceed global/process limits.
- [ ] Harness replacement and orphan recovery tests pass with pool metadata.
- [ ] CLI and overlay golden tests pass.
- [ ] Live local smoke test verifies the actual Pi/`br`/`bv`/Agent Mail environment.
- [ ] Four-hour fake-runtime soak has bounded process count, timers, and event growth.
- [ ] Package tarball contains roles, skill, extension, CLI, and no runtime state.
- [ ] README documents setup, model inheritance, Agent Mail prerequisite, shared-main workflow, and limitations.

## F.11 Definition of done

V1 is complete when the following command sequence works in a real configured project:

```bash
pi-messenger-swarm setup \
  --worker 'inherit=3' \
  --max-concurrent 3 \
  --start

pi-messenger-swarm status --explain
pi-messenger-swarm worker list
```

And the observed behavior is:

```text
Pi loads the project's AGENTS.md
three workers start only when ready Beads exist
workers claim and coordinate through the established ACFS workflow
completed/failed workers exit
pool slots refill without manual pane farming
harness replacement preserves live worker occupancy
operator UI shows models, Beads, phases, and exact idle/failure reasons
no second task, message, reservation, Git, or model authority exists
```
