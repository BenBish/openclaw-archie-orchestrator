# E2E Smoke Test

Use this when changing Archie Orchestrator behavior.

## Goal

Verify that a packed plugin installs into a fresh OpenClaw home and that a model-driven coding task can:

- create durable Archie task state
- make a small code change
- run project tests
- finish the task with Archie lifecycle state set to `completed`

## Commands

From the plugin repo:

```bash
npm test
npm run build
openclaw --profile archie plugins build --root "$PWD" --entry ./dist/index.js
openclaw --profile archie plugins validate --root "$PWD" --entry ./dist/index.js
mkdir -p /tmp/openclaw-archie-e2e-pack
npm --cache /tmp/openclaw-archie-npm-cache pack --pack-destination /tmp/openclaw-archie-e2e-pack
```

Create a temp project with a passing baseline test, then install the tarball into a fresh OpenClaw home:

```bash
export E2E_HOME=/tmp/openclaw-archie-e2e-home
export E2E_REPO=/tmp/openclaw-archie-e2e-repo
mkdir -p "$E2E_HOME" "$E2E_REPO"
HOME="$E2E_HOME" openclaw setup --non-interactive --accept-risk --workspace "$E2E_REPO" || true
HOME="$E2E_HOME" openclaw plugins install /tmp/openclaw-archie-e2e-pack/openclaw-plugin-archie-orchestrator-*.tgz
HOME="$E2E_HOME" openclaw plugins inspect archie-orchestrator
```

Run the live agent with the installed plugin available in an authenticated profile whose configured workspace points at the temp project. The `agent` command uses the profile workspace, not the shell working directory.

```bash
openclaw --profile archie plugins install --force /tmp/openclaw-archie-e2e-pack/openclaw-plugin-archie-orchestrator-*.tgz
openclaw --profile archie setup --non-interactive --accept-risk --workspace "$E2E_REPO" || true
openclaw --profile archie agent --local --session-key archie-plugin-e2e --model mini --message "<small coding task prompt>"
```

## Acceptance

- `openclaw plugins inspect archie-orchestrator` reports `status: loaded`.
- The agent uses `archie_task_init`.
- The agent uses `archie_task_start` before or during implementation.
- The agent uses `archie_task_finish` after verification.
- The temp project tests pass.
- The task `status.json` ends with `"state": "completed"`.

If code changes and tests pass but the task remains `queued`, the smoke test failed.
