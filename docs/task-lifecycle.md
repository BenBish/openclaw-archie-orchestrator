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
