# Archie Orchestrator

Archie Orchestrator packages the reusable parts of an engineering-focused OpenClaw workflow as an installable plugin. It gives an existing Claw durable task state, implementation queue tracking, review/manual-testing transitions, usage summaries, and bundled skills for issue design, research, and implementation coordination.

This repository is intentionally not a profile snapshot. It contains no live OpenClaw state, credentials, memory database, chat sessions, Telegram state, or personal configuration.

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

## Security

Never commit:

- `.env`
- OpenClaw auth databases
- `openclaw.json` with real tokens
- credentials, device identity, Telegram state, sessions, logs, memory DBs, cron state, backups, or generated npm/plugin state

Run a secret scanner before publishing.
