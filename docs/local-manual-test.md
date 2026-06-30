# Local Manual Test

Use this guide to verify a local checkout of Archie Orchestrator before publishing or relying on it from an OpenClaw profile.

## Prerequisites

- Node.js and npm are installed.
- OpenClaw CLI is installed and available as `openclaw`.
- You have an OpenClaw profile with model access if you plan to run the live agent test.
- Run commands from the repository root.

This plugin stores task state outside the repository by default:

```text
~/.openclaw-archie-orchestrator/state
```

Pass `stateRoot` to the Archie tools during testing if you want disposable state.

## 1. Build And Unit Test

```bash
npm install
npm test
npm run build
```

Expected result:

- Vitest reports all tests passing.
- TypeScript exits successfully.
- `dist/index.js` exists.

## 2. Validate And Pack The Plugin

If your default OpenClaw profile is valid:

```bash
npm run plugin:validate
npm run plugin:build
```

If your default profile has unrelated local config issues, use a known-good profile directly:

```bash
openclaw --profile archie plugins build --root . --entry ./dist/index.js
openclaw --profile archie plugins validate --root . --entry ./dist/index.js
```

Expected result:

- `openclaw.plugin.json` is valid.
- The plugin declares the `archie-orchestrator` id.
- The plugin exposes the Archie task tools.

## 3. Run The Install Smoke Test

```bash
npm run e2e:install
```

This creates a fresh temporary OpenClaw home under `/tmp`, installs the packed plugin there, and verifies that OpenClaw can load it.

Expected result:

```text
Archie e2e install smoke passed with openclaw-plugin-archie-orchestrator-0.3.0.tgz
```

## 4. Install Into A Local Profile

Install the local checkout into the profile you want to test:

```bash
openclaw --profile archie plugins install --link .
openclaw --profile archie plugins enable archie-orchestrator
```

Restart the gateway for that profile if one is running:

```bash
systemctl --user restart openclaw-gateway-archie.service
```

Inspect the plugin:

```bash
openclaw --profile archie plugins inspect archie-orchestrator
```

Expected result:

- The plugin status is `loaded`.
- The configured extensions include this repository.

## 5. Exercise The Tools Manually

Use a disposable state root so the test does not touch existing Archie tasks:

```bash
rm -rf /tmp/archie-orchestrator-manual-state
```

Start an OpenClaw agent against a small local workspace and ask it to use the plugin tools:

```bash
mkdir -p /tmp/archie-orchestrator-manual-repo
cd /tmp/archie-orchestrator-manual-repo
cat > package.json <<'JSON'
{
  "name": "archie-orchestrator-manual-repo",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node test.js"
  }
}
JSON
cat > math.js <<'JS'
export function add(a, b) {
  return a + b;
}
JS
cat > test.js <<'JS'
import { add } from "./math.js";

if (add(2, 3) !== 5) {
  throw new Error("add should sum two numbers");
}

console.log("ok");
JS
npm test
```

Then run:

```bash
openclaw --profile archie agent --local --model mini --message "Use the Archie Orchestrator plugin. For every Archie tool call, pass stateRoot /tmp/archie-orchestrator-manual-state. Create task MANUAL-ARCHIE-1, start it, add and export multiply(a, b) in math.js, update test.js to assert multiply(3, 4) is 12, run npm test, and finish the task as completed if tests pass."
```

Expected result:

- The agent uses `archie_task_init`.
- The agent uses `archie_task_start`.
- The agent edits `math.js` and `test.js`.
- `npm test` passes.
- The agent uses `archie_task_finish` with `result: "completed"`.

Check durable state:

```bash
node -e "const s=require('/tmp/archie-orchestrator-manual-state/tasks/MANUAL-ARCHIE-1/status.json'); console.log(JSON.stringify({taskId:s.taskId,state:s.state}, null, 2))"
```

Expected result:

```json
{
  "taskId": "MANUAL-ARCHIE-1",
  "state": "completed"
}
```

The real file contains more fields; the important value is `"state": "completed"`.

## 6. Run The Live Smoke Test

Use this after the manual tool check, or when validating a release candidate:

```bash
ARCHIE_E2E_PROFILE=archie npm run e2e:live
```

This test installs the packed plugin into the selected profile, temporarily points that profile at a generated project, runs a live coding task, verifies task completion, and restores the original workspace.

Useful options:

- `ARCHIE_E2E_MODEL=mini`: model alias or id for the live agent run.
- `ARCHIE_E2E_AGENT_TIMEOUT=600`: timeout in seconds.
- `ARCHIE_E2E_SKIP_GATEWAY_RESTART=1`: skip gateway restart if no gateway service is running.
- `ARCHIE_E2E_RUN_ID=my-test`: stable suffix for task/session ids.

## Cleanup

```bash
rm -rf /tmp/archie-orchestrator-manual-state
rm -rf /tmp/archie-orchestrator-manual-repo
```

If you installed with `--link` and want to remove the plugin from the test profile:

```bash
openclaw --profile archie plugins disable archie-orchestrator
openclaw --profile archie plugins uninstall archie-orchestrator
systemctl --user restart openclaw-gateway-archie.service
```

## Troubleshooting

- If validation fails before checking the plugin, run `openclaw --profile <profile> config validate` and fix that profile's config.
- If `plugins inspect` does not show `loaded`, restart the profile gateway and inspect again.
- If the live agent edits files but task state remains `queued`, the plugin tools were not used correctly.
- If state appears under `~/.openclaw-archie-orchestrator/state`, the agent likely omitted the explicit `stateRoot` argument in one or more Archie tool calls.
