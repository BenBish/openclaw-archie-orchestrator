---
name: work
description: "Use when the user wants to implement, fix, or build an issue or task using Archie Orchestrator's durable task workflow."
---

# Work

Use Archie Orchestrator to turn a requested implementation into durable task state, worker instructions, verification, review, and manual testing records.

## Workflow

1. Clarify the requested task and acceptance criteria.
2. Create or identify a workspace/worktree for the worker.
3. Call `archie_task_init` with:
   - task id
   - title
   - workspace path
   - repository path if known
   - issue URL if known
   - request, context, acceptance criteria, and review notes
4. Check `archie_queue_status` before launching implementation work.
5. Call `archie_task_start` before implementation begins. Do not pass `stateRoot` unless the user explicitly asks to use a non-default state directory.
6. Launch the configured worker command using the task files as the source of truth, or implement directly when the user asked for a small local task.
7. Run the configured CI and E2E commands.
8. Review the diff before approval.
9. Call `archie_task_finish` with `result: "completed"` after tests pass, or `result: "blocked"` with a clear summary when implementation cannot be completed.

## Guardrails

- Keep large issue payloads in task files, not chat.
- Prefer `archie_task_start` and `archie_task_finish` for normal work; use `archie_task_transition` only when a specific one-step lifecycle transition is needed.
- Do not merge a PR before review and manual testing requirements are complete.
- Do not store secrets in task files.
- Prefer project-local test commands from plugin config or repository docs.
