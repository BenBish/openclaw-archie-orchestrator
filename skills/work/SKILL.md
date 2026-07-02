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
9. Call `archie_task_finish` with `result: "completed"` after tests pass, or `result: "blocked"` with a clear summary when implementation cannot be completed. If the project or user requires a manual testing step before completion, pass `requireManualTesting: true` explicitly on this call — do not rely on the plugin's `review.requireManualTesting` config alone, since plugin config is not reliably delivered to tool calls under every OpenClaw runtime. When that flag is set and the task isn't already past manual testing, the task lands in `awaiting_manual_testing` instead of `completed`; after manual testing is done, call `archie_task_finish` again with `result: "completed"` to complete it.

## Guardrails

- Keep large issue payloads in task files, not chat.
- Prefer `archie_task_start` and `archie_task_finish` for normal work; use `archie_task_transition` only when a specific one-step lifecycle transition is needed.
- Do not merge a PR before review and manual testing requirements are complete.
- Do not store secrets in task files.
- Prefer project-local test commands from plugin config or repository docs.
- Do not assume plugin config (e.g. `stateRoot`, `review.requireManualTesting`) reaches tool calls automatically. Pass known-important values explicitly as tool arguments when the caller has them.
- Never edit Archie's task state files (`status.json`, `events.jsonl`, or anything under `stateRoot`) directly, and never hand-simulate what an Archie tool call would have done. If Archie tools are unavailable in a session, stop and report that blocker instead of proceeding — do not fabricate task state to make it look like the workflow completed. Archie tools reject calls against a task whose `status.json` fails its integrity check (returned as `integrityViolation: true`); this happens automatically when state was written outside the plugin's own tools, and requires an explicit `acknowledgeIntegrityViolation: true` after investigating the task before any further tool call on it will proceed.
