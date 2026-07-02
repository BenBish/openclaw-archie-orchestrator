# Task Lifecycle

Archie tasks are stored as directories under `stateRoot/tasks/<task-id>/`.

Core files:

- `status.json`: lifecycle state, worker metadata, review/manual-testing state, usage totals, and an `integrity` signature over its own contents (see below).
- `request.md`: user request or issue summary.
- `context.md`: implementation context.
- `acceptance.md`: acceptance criteria.
- `review-notes.md`: feedback for retries and review findings.
- `events.jsonl`: append-only lifecycle events.
- `artifacts/`: worker logs, verification output, screenshots, and usage captures.

Lifecycle:

```text
queued
preparing
running
awaiting_worker_exit_reconcile
awaiting_pr
awaiting_review
awaiting_manual_testing
completed
```

Retry and terminal states:

```text
retry_planned
retry_running
blocked
cancelled
```

The plugin tools enforce lifecycle transitions so task state remains durable and auditable.

For normal implementation work, use:

- `archie_task_start` after task creation or when implementation begins.
- `archie_task_finish` after verification to mark the task `completed`, `blocked`, or `cancelled`.

`archie_task_transition` remains strict and is best for advanced one-step lifecycle control. The helper tools still write one event per actual transition, so the audit trail remains explicit.

## Integrity

`status.json` is only ever meant to be written by these plugin tools. Every save computes a
signature (`integrity`) over the file's own contents; every load recomputes it and compares. A
task whose signature is missing or doesn't match — `integrityViolation: true` in any tool's
response — was created or edited outside these tools (by hand, or by an agent working around a
tool-availability problem instead of reporting it). `archie_task_transition`, `archie_task_start`,
`archie_task_finish`, and `archie_task_update` all refuse to touch a task in that state until the
caller investigates `status.json`/`events.jsonl` and explicitly passes
`acknowledgeIntegrityViolation: true`, which re-signs it going forward. Read-only tools
(`archie_task_read`, `archie_queue_status`, `archie_usage_report`) still return violated tasks —
you need to be able to read a task to investigate it — they just don't let anything mutate it
silently.
