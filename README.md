# Archie Orchestrator

Archie Orchestrator packages the reusable parts of an engineering-focused OpenClaw workflow as an installable plugin. It gives an existing Claw durable task state, implementation queue tracking, review/manual-testing transitions, usage summaries, and bundled skills for issue design, research, and implementation coordination.

This repository is intentionally not a profile snapshot. It contains no live OpenClaw state, credentials, memory database, chat sessions, Telegram state, or personal configuration.

## Status

This repository is kept for historical/reference purposes. It underwent an extensive end-to-end
test, including a real-world build task (a Pomodoro timer app, with a genuine bug found via real
browser testing, correctly diagnosed and fixed by an agent from durable task notes alone) — full
account in [docs/e2e-test-run-log.md](docs/e2e-test-run-log.md).

The plugin's own logic held up well under that testing (task lifecycle, manual-testing gate,
concurrency enforcement, and a state-integrity check added during the exercise — 73 unit tests,
each new behavior also verified live). The overall workflow did not: OpenClaw's plugin config was
not reliably delivered to tool calls under the CLI's one-shot/embedded agent runtime, and the
plugin's tools intermittently failed to be exposed to the agent at all through the Codex harness,
for reasons that persisted through extensive troubleshooting (including a from-scratch fresh
OpenClaw profile) and were never fully resolved. Separately, before a fix was added, an agent
blocked by that tool-availability gap chose to fabricate durable task state by hand rather than
stop and report the blocker — a real autonomy/trust finding, not a hypothetical one.

In short: this plugin was not found to be a reliable method for unattended real-world software
engineering work, primarily due to platform-level gaps outside this plugin's control rather than
defects in its own code. Read the full log before relying on it for anything beyond reference.

## Install

```bash
openclaw plugins install github:BenBish/openclaw-archie-orchestrator
openclaw plugins enable archie-orchestrator
```

For local development:

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
openclaw plugins install --link .
```

For a local end-to-end checklist, see [docs/local-manual-test.md](docs/local-manual-test.md).

## What It Adds

- `archie_task_init`: create task state and task files.
- `archie_task_read`: inspect task status and notes.
- `archie_task_transition`: move a task through the lifecycle.
- `archie_task_start`: start implementation by walking queued/preparing tasks to running.
- `archie_task_finish`: complete, block, or cancel a task through legal lifecycle states.
- `archie_task_update`: update task request/context/acceptance/review-note files.
- `archie_queue_status`: inspect active, pending, and terminal tasks.
- `archie_usage_report`: summarize recorded usage totals.
- Bundled skills:
  - `work`: orchestrate implementation work.
  - `issue`: design and triage issue work.
  - `research`: investigate repositories, docs, and system behavior.

## State

By default, task state is written to:

```text
~/.openclaw-archie-orchestrator/state
```

Each tool also accepts `stateRoot` for explicit state isolation. Keep state outside the plugin directory so upgrades do not remove task records.

Every `status.json` carries an `integrity` signature computed over its own contents. `archie_task_transition`, `archie_task_start`, `archie_task_finish`, and `archie_task_update` refuse to modify a task whose signature is missing or doesn't match (surfaced as `integrityViolation: true` from any tool, including read-only ones) — this is what catches task state that was created or edited outside these tools, for example by hand or by an agent working around a tool-availability problem instead of reporting it. Pass `acknowledgeIntegrityViolation: true` after investigating the task's `status.json` and `events.jsonl` to proceed anyway; this re-signs the task going forward.

## Configuration

See [examples/openclaw.config.example.json](examples/openclaw.config.example.json). Configure secrets through environment variables or OpenClaw SecretRefs. Do not commit real tokens.

Common settings:

- `stateRoot`: durable task state directory.
- `worker.command`: worker CLI, for example `claude`.
- `worker.defaultModel`: default implementation worker model.
- `worker.maxTurns`: worker turn budget.
- `concurrency.maxActiveWorkers`: active worker limit.
- `issueProvider.type`: `none` or `linear`.
- `verification.ciCommand`: project CI command.
- `verification.e2eCommand`: project E2E command.
- `review.requireManualTesting`: require a manual testing phase before completion.

Plugin config is not reliably delivered to tool calls under every OpenClaw runtime (observed:
empty config under CLI one-shot / embedded `agent --local` runs in some OpenClaw versions). For
`review.requireManualTesting` specifically, pass the equivalent `requireManualTesting` boolean
directly on the `archie_task_finish` call instead of relying on config — it takes precedence over
the config value and works regardless of that gap. `stateRoot` already follows this same
explicit-argument pattern for the same reason.

## Security

Never commit:

- `.env`
- OpenClaw auth databases
- `openclaw.json` with real tokens
- credentials, device identity, Telegram state, sessions, logs, memory DBs, cron state, backups, or generated npm/plugin state

Run a secret scanner before publishing.
