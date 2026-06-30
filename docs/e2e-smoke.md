# E2E Smoke Test

Use this when changing Archie Orchestrator behavior.

## Goal

Verify that a packed plugin installs into a fresh OpenClaw home and that a model-driven coding task can:

- create durable Archie task state
- make a small code change
- run project tests
- finish the task with Archie lifecycle state set to `completed`

## Commands

Run the install-only smoke test first. It builds, validates, packs, installs into a fresh temporary OpenClaw home, and checks that the packed plugin loads.

```bash
npm run e2e:install
```

Run the live smoke test when an authenticated OpenClaw profile has model access. This installs the packed plugin into that profile, temporarily points its workspace at the temp project, runs a live coding task, verifies Archie lifecycle completion, and restores the original workspace.

```bash
ARCHIE_E2E_PROFILE=archie npm run e2e:live
```

Optional environment variables:

- `ARCHIE_E2E_PROFILE`: authenticated OpenClaw profile for the live agent run. Defaults to `archie`.
- `ARCHIE_E2E_BUILD_PROFILE`: OpenClaw profile used for plugin build/validate. Defaults to `ARCHIE_E2E_PROFILE`.
- `ARCHIE_E2E_MODEL`: model alias/id for the live run. Defaults to `mini`.
- `ARCHIE_E2E_AGENT_TIMEOUT`: live agent timeout in seconds. Defaults to `600`.
- `ARCHIE_E2E_GATEWAY_SERVICE`: user service restarted after live profile plugin install. Defaults to `openclaw-gateway-$ARCHIE_E2E_PROFILE.service`.
- `ARCHIE_E2E_SKIP_GATEWAY_RESTART`: set to `1` to skip the service restart.
- `ARCHIE_E2E_TMP`: temp root. Defaults to `/tmp`.
- `ARCHIE_E2E_RUN_ID`: stable suffix for session/task ids.

## Acceptance

- `openclaw plugins inspect archie-orchestrator` reports `status: loaded`.
- The agent uses `archie_task_init`.
- The agent uses `archie_task_start` before or during implementation.
- The agent uses `archie_task_finish` after verification.
- The temp project tests pass.
- The task `status.json` ends with `"state": "completed"`.
- The selected profile workspace is restored after the live run, even on failure.

If code changes and tests pass but the task remains `queued`, the smoke test failed.
