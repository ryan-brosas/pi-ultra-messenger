# AGENTS.md — pi-ultra-messenger

> Operating contract for AI agents working on this project.
> Work is tracked through **omp native goal mode** (`/goal` + built-in
> TODOs) — never through Beads (`br`/`bv`) and never through a custom goal queue.
> Read this file before doing anything else.

---

## Project Identity

**pi-ultra-messenger** is a fork of `monotykamary/pi-messenger-swarm@1b17674150b6b3a13f287be0660cf0382e8c5656` (package `0.25.22`) customized into a continuous Pi worker pool for the Agent Flywheel workflow.

- **Runtime:** TypeScript, one Pi package, one CLI, one Pi extension
- **Coding agent runtime:** Pi only
- **Plan of record:** `PLAN_TO_FORK_PI_MESSENGER_SWARM_CODE_LEVEL_IMPLEMENTATION_BLUEPRINT_V6_UI_UX(6) (1).md` (v12.0) — the source of truth for what to build and in what order
- **Fork base:** pinned commit above; preserve upstream machinery, remove redundant Pi Messenger coordination surfaces

The product being built is described in full in the plan. This AGENTS.md is the operating contract for agents developing it — it does not duplicate or re-architect the plan's runtime design.

---

## RULE 0 — THE FUNDAMENTAL OVERRIDE PREROGATIVE

If I tell you to do something, even if it goes against what follows below, YOU MUST LISTEN TO ME. I AM IN CHARGE, NOT YOU.

---

## RULE 1 — NO FILE DELETION

**YOU ARE NEVER ALLOWED TO DELETE A FILE WITHOUT EXPRESS PERMISSION.** Even a new file that you yourself created, such as a test code file. You have a horrible track record of deleting critically important files or otherwise throwing away tons of expensive work. As a result, you have permanently lost any and all rights to determine that a file or folder should be deleted.

**YOU MUST ALWAYS ASK AND RECEIVE CLEAR, WRITTEN PERMISSION BEFORE EVER DELETING A FILE OR FOLDER OF ANY KIND.**

---

## Irreversible Git & Filesystem Actions — DO NOT EVER BREAK GLASS

1. **Absolutely forbidden commands:** `git reset --hard`, `git clean -fd`, `rm -rf`, or any command that can delete or overwrite code/data must never be run unless the user explicitly provides the exact command and states, in the same message, that they understand and want the irreversible consequences.
2. **No guessing:** If there is any uncertainty about what a command might delete or overwrite, stop immediately and ask for specific approval. "I think it safe" is never acceptable.
3. **Safer alternatives first:** When cleanup or rollbacks are needed, request permission to use non-destructive options (`git status`, `git diff`, `git stash`, copying to backups) before ever considering a destructive command.
4. **Mandatory explicit plan:** Even after explicit user authorization, restate the command verbatim, list exactly what will be affected, and wait for a confirmation that your understanding is correct. Only then may you execute it—if anything remains ambiguous, refuse and escalate.
5. **Document the confirmation:** When running any approved destructive command, record (in the session notes / final response) the exact user text that authorized it, the command actually run, and the execution time. If that record is absent, the operation did not happen.

---

## Git Branch: ONLY Use `main`, NEVER `master`

**The default branch is `main`. The `master` branch exists only for legacy URL compatibility.**

- **All work happens on `main`** — commits, PRs, feature branches all merge to `main`
- **Never reference `master` in code or docs** — if you see `master` anywhere, it's a bug that needs fixing
- **The `master` branch must stay synchronized with `main`** — after pushing to `main`, also push to `master`:
  ```bash
  git push origin main:master
  ```

---

## Code Editing Discipline

### No Script-Based Changes

**NEVER** run a script that processes/changes code files in this repo. Brittle regex-based transformations create far more problems than they solve.

- **Always make code changes manually**, even when there are many instances
- For many simple changes: use parallel subagents
- For subtle/complex changes: do them methodically yourself

### No File Proliferation

If you want to change something or add a feature, **revise existing code files in place**.

**NEVER** create variations like `mainV2.ts`, `main_improved.ts`, `main_enhanced.ts`.

New files are reserved for **genuinely new functionality** that makes zero sense to include in any existing file. The bar for creating new files is **incredibly high**. The fork keeps the existing package shape: one TypeScript package, one CLI, one Pi extension. It does not become a monorepo or a broad platform rewrite.

---

## Backwards Compatibility

We do not care about backwards compatibility—we're in early development with no users. We want to do things the **RIGHT** way with **NO TECH DEBT**.

- Never create "compatibility shims"
- Never create wrapper functions for deprecated APIs
- Just fix the code directly

---

## Goal-Mode Work Tracking

This project uses **omp native goal mode**. No `.beads/` directory, no `br`, no `bv`, no custom goal queue.

- **`/goal`:** The `/goal` outcome defines the end-state. The goal supervisor observes every turn and steers back if the agent drifts.
- **Built-in TODOs:** Use the built-in TODO functionality for multi-step task tracking. If asked to use TODOs, do so without complaint.
- **Plan of record:** The implementation blueprint is the source of truth for what to build and in what order. Track progress against its phases and exit gates.

---

## Implementation Phases (from the plan)

Work proceeds in order. Each phase has an exit gate. Do not skip phases.

| Phase | Summary | Exit gate |
|---|---|---|
| **0** | Pin upstream commit, run install/typecheck/test/build, capture local Pi/model/Agent Mail fixtures, verify target AGENTS.md path | No command/output shape used by implementation remains guessed |
| **1** | Disable Pi Messenger task/channel/feed/send/reservation routes; keep spawn/list/history/stop working | A manual spawn runs without any Pi Messenger task/message/reservation command |
| **2** | Wire `model` through SpawnRequest/CLI/handler, remove `--no-session` for managed workers, capture actual model, add pool fields to spawn records | Manual exact-model and inherit spawns work, sessions save normally, history shows requested/actual models |
| **3** | Implement Pi RPC model probe + cached inventory, interactive and non-interactive `setup`, pool commands, config validation | The owner's example allocation can be entered in one command when those exact models are visible; invalid models are rejected before config write |
| **4** | Add one-pool continuous supervisor: read-only ready-work client, coalesced tick, staggered refill respecting ready count / pending selectors / global cap / starts-per-tick, backoff, post-exit refill trigger, CLI/status reasons | One pool continuously replaces workers while ready work exists *(0.1 Worker Pool Preview)* |
| **5** | Deterministic round-robin multi-pool allocation, worker status telemetry, harness-restart pool-occupancy reconstruction, per-pool unavailable-model blocking | Two pools maintain the configured mix under a global cap and recover correctly after harness replacement *(0.2 Multi-Pool Preview)* |
| **6** | Replace the overlay with `/swarm` (Overview/Workers/Pools/Activity/Diagnostics), responsive layouts, empty/degraded states, UI golden tests | The dashboard accurately reflects the same state as CLI JSON |
| **7** | Add optional coordinator and suggestion-only goal refiner as disabled-by-default roles that never gate refill | Coordinator/refiner can be completely disabled without changing worker operation *(0.3 Tending Preview)* |
| **8** | Cleanup, fake-runtime soak, README/CHANGELOG, package audit, install-from-tarball/git test | All V1 criteria pass and no disabled legacy route is reachable |

---

## Release Gates (V1 Acceptance Criteria)

- **Baseline:** Pinned upstream build passes or failures documented · local Pi version + model fixture captured · target AGENTS.md found.
- **Authority boundaries:** No custom task/messaging/reservation surface reachable · supervisor uses read-only ready-work queries · workers use Agent Mail directly · workers own Git lifecycle per target `AGENTS.md`.
- **Pi:** Inherit passes no model override · exact model uses verified upstream style · shipped role files have no model default · managed workers save sessions · context files stay enabled · actual model captured.
- **Pools:** `--worker MODEL=COUNT` repeatable · exact models validated through Pi · global max enforced + revalidated before spawn · targets may exceed global max · round-robin deterministic · unavailable model blocks only its pool · scale-down does not kill active workers.
- **Supervisor:** Disabled/paused = no starts · no ready work = no starts · ready count bounds starts · pending selectors subtract from demand · no-work exits trigger bounded backoff · starts staggered · worker terminal event triggers refill · no automatic retry/reassign of the same work item.
- **AGENTS.md:** Unattended start requires AGENTS.md · worker first action says read full AGENTS.md + README · post-compaction reread instruction present · tool behavior delegated to AGENTS.md, not duplicated in supervisor code.
- **Recovery:** Clean harness replacement preserves workers · crash orphan recovery restores live PIDs · dead PID becomes failed · restored pool occupancy prevents duplicate refill · detached status clearly says live output unavailable.
- **UI/CLI:** Bare invocation quick start · human/plain/JSON outputs tested · `/swarm` works at target widths · why-idle/capped reasons visible · no Agent Mail message body displayed or persisted.
- **Optional roles:** Coordinator disabled by default · refiner disabled by default · coordinator does not gate refill · refiner does not edit source or assign/close work.

---

## No-Invented-Subsystem Rule (V1)

V1 must not introduce any of these. If a future problem demonstrably requires one, it belongs in a separate post-V1 plan backed by measurements from the shipped worker pool:

```text
new task database · new message database · new reservation authority
new generic MCP framework · new transactional control database
new ProjectActor framework · new StartPermit or admission-saga platform
new AttemptRunner executable · new Git landing or merge service
new worktree manager · new filesystem sandbox claim
new multi-host scheduler · new provider credential store
new model registry separate from Pi
```

---

## Compiler Checks (CRITICAL)

**After any substantive code changes, you MUST verify no errors were introduced.**

This is a TypeScript project:

```bash
bun install
bun typecheck   # or tsc --noEmit
bun lint        # or eslint
bun test        # Vitest
bun run build
```

If you see errors, **carefully understand and resolve each issue**. Read sufficient context to fix them the RIGHT way.

### Third-Party Library Usage

If you aren't 100% sure how to use a third-party library, **SEARCH ONLINE** to find the latest documentation and current best practices.

---

## Testing

### Before Committing

Always run the project's test suite before committing code changes:

```bash
bun test
```

### End-to-End Testing

If the project has E2E tests, run them:

```bash
./scripts/e2e_test.sh  # or equivalent
```

---

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **Run quality gates** (if code changed) — `bun typecheck`, `bun lint`, `bun test`, `bun run build`
2. **Update progress** — mark completed phases/tasks in the built-in TODO list; note remaining work against the plan's phases
3. **PUSH TO REMOTE** — this is MANDATORY:
   ```bash
   git pull --rebase
   git add <changed files>   # Stage exact files, never `git add .`
   git commit -m "type(scope): description"
   git push
   git push origin main:master   # keep legacy branch synchronized
   git status  # MUST show "up to date with origin"
   ```
4. **Clean up** — Clear stashes, prune remote branches
5. **Verify** — All changes committed AND pushed
6. **Hand off** — Provide context for next session: which phase, what's done, what's next

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing — that leaves work stranded locally
- NEVER say "ready to push when you are" — YOU must push
- If push fails, resolve and retry until it succeeds

---

## Note on Multi-Agent Environments

You constantly bother me and stop working with concerned questions that look similar to this:

```
Unexpected changes (need guidance)

- Working tree still shows edits I did not make in Cargo.toml, Cargo.lock, ...
Please advise whether to keep/commit/revert these before any further work.
I did not touch them.
```

NEVER EVER DO THAT AGAIN. The answer is literally ALWAYS the same: those are changes created by the potentially dozen of other agents working on the project at the same time. This is not only a common occurrence, it happens multiple times PER MINUTE. The way to deal with it is simple: you NEVER, under ANY CIRCUMSTANCE, stash, revert, overwrite, or otherwise disturb in ANY way the work of other agents. Just treat those changes identically to changes that you yourself made. Just fool yourself into thinking YOU made the changes and simply don't recall it for some reason.

---

## Note on Built-in TODO Functionality

If I ask you to explicitly use your built-in TODO functionality, don't complain about this and say you need to use beads. You can use built-in TODOs if I tell you specifically to do so. Always comply with such orders. This project is goal-mode — built-in TODOs are the intended task tracker, not `br`/`bv`.
