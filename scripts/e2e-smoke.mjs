#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const MODE = process.argv[2] || "install";
const PROFILE = process.env.ARCHIE_E2E_PROFILE || "archie";
const BUILD_PROFILE = process.env.ARCHIE_E2E_BUILD_PROFILE || PROFILE;
const MODEL = process.env.ARCHIE_E2E_MODEL || "mini";
const AGENT_TIMEOUT_SECONDS = process.env.ARCHIE_E2E_AGENT_TIMEOUT || "600";
const GATEWAY_SERVICE = process.env.ARCHIE_E2E_GATEWAY_SERVICE || `openclaw-gateway-${PROFILE}.service`;
const RUN_ID = process.env.ARCHIE_E2E_RUN_ID || `${Date.now()}`;
const BASE_TMP = process.env.ARCHIE_E2E_TMP || "/tmp";
const PACK_DIR = join(BASE_TMP, "openclaw-archie-e2e-pack");
const INSTALL_HOME = join(BASE_TMP, "openclaw-archie-e2e-home");
const REPO_DIR = join(BASE_TMP, `openclaw-archie-e2e-repo-${RUN_ID.replace(/[^A-Za-z0-9_-]/g, "-")}`);
const NPM_CACHE = join(BASE_TMP, "openclaw-archie-npm-cache");
const TASK_ID = `ARCHIE-E2E-${RUN_ID.replace(/[^A-Za-z0-9_-]/g, "-")}`;
let activeWorkspaceRestore = null;

function profileHome(profile) {
  if (process.env.ARCHIE_E2E_PROFILE_HOME) return resolve(process.env.ARCHIE_E2E_PROFILE_HOME);
  if (profile === "default" || profile === "main") return join(homedir(), ".openclaw");
  return join(homedir(), `.openclaw-${profile}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    timeout: options.timeout,
  });
  if ((result.error || result.status !== 0) && !options.allowFailure) {
    const detail = result.error ? `: ${result.error.message}` : "";
    const output = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${detail}${output ? `\n${output}` : ""}`);
  }
  return result;
}

function commandFailure(command, args, result) {
  const detail = result.error ? `: ${result.error.message}` : "";
  const output = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n");
  return new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${detail}${output ? `\n${output}` : ""}`);
}

function restoreWorkspaceSync() {
  if (!activeWorkspaceRestore) return;
  const { configPath, workspace } = activeWorkspaceRestore;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.agents ||= {};
  config.agents.defaults ||= {};
  config.agents.defaults.workspace = workspace;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  activeWorkspaceRestore = null;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    restoreWorkspaceSync();
    process.kill(process.pid, signal);
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseFirstJsonObject(output) {
  const start = output.indexOf("{");
  if (start < 0) throw new Error(`Command output did not contain JSON:\n${output}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < output.length; i++) {
    const char = output[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return JSON.parse(output.slice(start, i + 1));
    }
  }
  throw new Error(`Command output contained incomplete JSON:\n${output}`);
}

function restartProfileGateway() {
  if (process.env.ARCHIE_E2E_SKIP_GATEWAY_RESTART === "1") return;
  run("systemctl", ["--user", "restart", GATEWAY_SERVICE]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureProject() {
  rmSync(REPO_DIR, { recursive: true, force: true });
  await mkdir(REPO_DIR, { recursive: true });
  await writeJson(join(REPO_DIR, "package.json"), {
    name: "openclaw-archie-e2e-repo",
    version: "0.0.0",
    type: "module",
    private: true,
    scripts: { test: "node test.js" },
  });
  await writeFile(
    join(REPO_DIR, "math.js"),
    `export function add(a, b) {\n  return a + b;\n}\n`,
    "utf8",
  );
  await writeFile(
    join(REPO_DIR, "test.js"),
    `import { add } from "./math.js";\n\nif (add(2, 3) !== 5) {\n  throw new Error("add should sum two numbers");\n}\n\nconsole.log("ok");\n`,
    "utf8",
  );
}

async function buildPack() {
  rmSync(PACK_DIR, { recursive: true, force: true });
  await mkdir(PACK_DIR, { recursive: true });
  run("npm", ["test"]);
  run("npm", ["run", "build"]);
  run("openclaw", ["--profile", BUILD_PROFILE, "plugins", "build", "--root", ROOT, "--entry", "./dist/index.js"]);
  run("openclaw", ["--profile", BUILD_PROFILE, "plugins", "validate", "--root", ROOT, "--entry", "./dist/index.js"]);
  run("npm", ["--cache", NPM_CACHE, "pack", "--pack-destination", PACK_DIR]);
  const packageJson = await readJson(join(ROOT, "package.json"));
  return join(PACK_DIR, `${packageJson.name}-${packageJson.version}.tgz`);
}

function assertPack(packPath) {
  if (!existsSync(packPath)) {
    throw new Error(`Expected package not found: ${packPath}`);
  }
}

async function installIntoFreshHome(packPath) {
  rmSync(INSTALL_HOME, { recursive: true, force: true });
  await mkdir(INSTALL_HOME, { recursive: true });
  await ensureProject();

  const env = { HOME: INSTALL_HOME };
  const setup = run(
    "openclaw",
    ["setup", "--non-interactive", "--accept-risk", "--workspace", REPO_DIR],
    { env, allowFailure: true, capture: true },
  );
  const configPath = join(INSTALL_HOME, ".openclaw", "openclaw.json");
  if (!existsSync(configPath)) {
    throw new Error(`Fresh OpenClaw setup did not write config. stderr:\n${setup.stderr}`);
  }
  const config = await readJson(configPath);
  if (config?.agents?.defaults?.workspace !== REPO_DIR) {
    throw new Error(`Fresh OpenClaw setup did not record workspace ${REPO_DIR}`);
  }

  run("openclaw", ["plugins", "install", packPath], { env });
  const inspect = run("openclaw", ["plugins", "inspect", "archie-orchestrator"], { env, capture: true });
  if (!inspect.stdout.includes("Status: loaded")) {
    throw new Error(`Fresh plugin inspect did not report loaded:\n${inspect.stdout}`);
  }
}

async function readProfileConfig(profile) {
  const configPath = join(profileHome(profile), "openclaw.json");
  if (!existsSync(configPath)) {
    throw new Error(`Profile config not found for ${profile}: ${configPath}`);
  }
  return { configPath, config: await readJson(configPath) };
}

async function setProfileWorkspace(profile, workspace) {
  const setup = run(
    "openclaw",
    ["--profile", profile, "setup", "--non-interactive", "--accept-risk", "--workspace", workspace],
    { allowFailure: true, capture: true },
  );
  const { configPath, config } = await readProfileConfig(profile);
  if (config?.agents?.defaults?.workspace === workspace) return;

  config.agents ||= {};
  config.agents.defaults ||= {};
  config.agents.defaults.workspace = workspace;
  await writeJson(configPath, config);

  const updated = await readJson(configPath);
  if (updated?.agents?.defaults?.workspace !== workspace) {
    throw new Error(`Failed to set ${profile} workspace to ${workspace}. stderr:\n${setup.stderr}`);
  }
}

async function restoreProfileWorkspace(profile, workspace) {
  const { configPath, config } = await readProfileConfig(profile);
  config.agents ||= {};
  config.agents.defaults ||= {};
  config.agents.defaults.workspace = workspace;
  await writeJson(configPath, config);
}

async function runLive(packPath) {
  await ensureProject();
  const { configPath, config } = await readProfileConfig(PROFILE);
  const originalWorkspace = config?.agents?.defaults?.workspace;
  if (!originalWorkspace) {
    throw new Error(`Profile ${PROFILE} does not define agents.defaults.workspace`);
  }
  activeWorkspaceRestore = { configPath, workspace: originalWorkspace };

  try {
    run("openclaw", ["--profile", PROFILE, "plugins", "install", "--force", packPath]);
    await setProfileWorkspace(PROFILE, REPO_DIR);
    restartProfileGateway();
    await sleep(2000);
    const message = [
      "Use the Archie Orchestrator plugin for this engineering task.",
      `Create durable task state with taskId ${TASK_ID}.`,
      "Start the task with archie_task_start.",
      "Add and export a multiply(a, b) function in math.js.",
      "Update test.js to assert multiply(3, 4) is 12 while preserving the existing add test.",
      "Run npm test.",
      "Finish the Archie task as completed with archie_task_finish if tests pass.",
    ].join(" ");
    const agentArgs = [
      "--profile",
      PROFILE,
      "agent",
      "--local",
      "--session-key",
      `archie-plugin-e2e-${RUN_ID}`,
      "--model",
      MODEL,
      "--timeout",
      AGENT_TIMEOUT_SECONDS,
      "--json",
      "--message",
      message,
    ];
    const agent = run(
      "openclaw",
      agentArgs,
      { cwd: REPO_DIR, capture: true, timeout: (Number(AGENT_TIMEOUT_SECONDS) + 30) * 1000, allowFailure: true },
    );
    let parsed;
    try {
      parsed = parseFirstJsonObject(agent.stdout);
    } catch {
      throw commandFailure("openclaw", agentArgs, agent);
    }
    if (agent.status !== 0 && !agent.error?.message.includes("ETIMEDOUT")) {
      throw commandFailure("openclaw", agentArgs, agent);
    }
    const tools = parsed?.meta?.toolSummary?.tools || [];
    for (const tool of ["archie_task_init", "archie_task_start", "archie_task_finish"]) {
      if (!tools.includes(tool)) {
        throw new Error(`Live agent did not use ${tool}. Observed tools: ${tools.length > 0 ? tools.join(", ") : "(none)"}`);
      }
    }
    run("npm", ["test"], { cwd: REPO_DIR });
    const math = await readFile(join(REPO_DIR, "math.js"), "utf8");
    const test = await readFile(join(REPO_DIR, "test.js"), "utf8");
    if (!math.includes("multiply") || !test.includes("multiply(3, 4)")) {
      throw new Error("Live agent did not make the expected temp project code change");
    }

    const stateRoot = process.env.ARCHIE_STATE_ROOT || join(homedir(), ".openclaw-archie-orchestrator", "state");
    const status = await readJson(join(stateRoot, "tasks", TASK_ID, "status.json"));
    if (status.state !== "completed") {
      throw new Error(`Expected ${TASK_ID} to be completed, got ${status.state}`);
    }
  } finally {
    await restoreProfileWorkspace(PROFILE, originalWorkspace);
    activeWorkspaceRestore = null;
    const restored = (await readProfileConfig(PROFILE)).config?.agents?.defaults?.workspace;
    if (restored !== originalWorkspace) {
      throw new Error(`Failed to restore ${PROFILE} workspace to ${originalWorkspace}`);
    }
  }
}

async function main() {
  if (!["install", "live"].includes(MODE)) {
    throw new Error(`Unknown mode ${MODE}. Use "install" or "live".`);
  }
  const packPath = await buildPack();
  assertPack(packPath);
  await installIntoFreshHome(packPath);
  if (MODE === "live") await runLive(packPath);
  console.log(`Archie e2e ${MODE} smoke passed with ${basename(packPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
