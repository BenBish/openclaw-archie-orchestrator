# Task Lifecycle

Archie tasks are stored as directories under `stateRoot/tasks/<task-id>/`.

Core files:

- `status.json`: lifecycle state, worker metadata, review/manual-testing state, usage totals.
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
