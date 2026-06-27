import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Schema = Record<string, unknown> & { __optional?: boolean };

const Type = {
  String: (options: { description?: string } = {}): Schema => ({
    type: "string",
    ...(options.description ? { description: options.description } : {}),
  }),
  Number: (): Schema => ({ type: "number" }),
  Boolean: (options: { description?: string } = {}): Schema => ({
    type: "boolean",
    ...(options.description ? { description: options.description } : {}),
  }),
  Literal: (value: string): Schema => ({ type: "string", const: value }),
  Union: (schemas: Schema[]): Schema => ({ anyOf: schemas }),
  Optional: (schema: Schema): Schema => ({ ...schema, __optional: true }),
  Object: (properties: Record<string, Schema>, options: { additionalProperties?: boolean } = {}): Schema => {
    const cleanProperties: Record<string, Schema> = {};
    const required: string[] = [];
    for (const [key, schema] of Object.entries(properties)) {
      const { __optional, ...cleanSchema } = schema;
      cleanProperties[key] = cleanSchema;
      if (!__optional) required.push(key);
    }
    return {
      type: "object",
      properties: cleanProperties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: options.additionalProperties ?? false,
    };
  },
};

type TaskStatus = {
  taskId: string;
  title: string;
  state: string;
  attempt: number;
  workspace: string;
  repo?: string;
  branch?: string;
  issueUrl?: string;
  requiresE2e: boolean;
  createdAt: string;
  updatedAt: string;
  worker: {
    sessionName: string | null;
    pid: number | null;
    logPath: string | null;
    exitCodePath: string | null;
  };
  review: {
    startedAt: string | null;
    completedAt: string | null;
    outcome: string | null;
    commentUrl: string | null;
    headRef: string | null;
  };
  manualTesting: {
    startedAt: string | null;
    completedAt: string | null;
    outcome: string | null;
    commentUrl: string | null;
  };
  usage: {
    attempts: JsonValue[];
    totals: {
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      turns: number;
    };
  };
};

const ACTIVE_STATES = new Set(["preparing", "running", "retry_running"]);
const TERMINAL_STATES = new Set(["blocked", "completed", "cancelled"]);
const CONFIG_SCHEMA = Type.Object(
  {
    stateRoot: Type.Optional(Type.String({ description: "Directory where Archie task state is stored." })),
    worker: Type.Optional(
      Type.Object(
        {
          command: Type.Optional(Type.String({ description: "Worker command used by the bundled skills." })),
          defaultModel: Type.Optional(Type.String()),
          maxTurns: Type.Optional(Type.Number()),
        },
        { additionalProperties: false },
      ),
    ),
    concurrency: Type.Optional(
      Type.Object(
        {
          maxActiveWorkers: Type.Optional(Type.Number()),
        },
        { additionalProperties: false },
      ),
    ),
    issueProvider: Type.Optional(
      Type.Object(
        {
          type: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("linear")])),
        },
        { additionalProperties: true },
      ),
    ),
    verification: Type.Optional(
      Type.Object(
        {
          ciCommand: Type.Optional(Type.String()),
          e2eCommand: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    review: Type.Optional(
      Type.Object(
        {
          requireManualTesting: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  queued: new Set(["preparing", "cancelled"]),
  preparing: new Set(["running", "cancelled"]),
  running: new Set(["awaiting_worker_exit_reconcile", "cancelled"]),
  awaiting_worker_exit_reconcile: new Set(["awaiting_pr", "awaiting_review", "retry_planned", "blocked", "cancelled"]),
  awaiting_pr: new Set(["awaiting_review", "retry_planned", "blocked", "cancelled"]),
  awaiting_review: new Set(["awaiting_manual_testing", "completed", "retry_planned", "cancelled"]),
  awaiting_manual_testing: new Set(["completed", "retry_planned", "cancelled"]),
  retry_planned: new Set(["retry_running", "blocked", "cancelled"]),
  retry_running: new Set(["awaiting_worker_exit_reconcile", "cancelled"]),
  blocked: new Set(["cancelled"]),
  completed: new Set(["cancelled"]),
  cancelled: new Set(),
};

function nowIso(): string {
  return new Date().toISOString();
}

function defaultStateRoot(): string {
  return join(homedir(), ".openclaw-archie-orchestrator", "state");
}

function resolveStateRoot(stateRoot?: string, configuredStateRoot?: string): string {
  return resolve(stateRoot?.trim() || configuredStateRoot?.trim() || process.env.ARCHIE_STATE_ROOT || defaultStateRoot());
}

function pathsFor(stateRoot?: string, configuredStateRoot?: string) {
  const root = resolveStateRoot(stateRoot, configuredStateRoot);
  return {
    root,
    tasksDir: join(root, "tasks"),
    queuesDir: join(root, "queues"),
    monitorDir: join(root, "monitor"),
    usageDir: join(root, "usage"),
    queuePath: join(root, "queues", "implementation.json"),
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function ensureRoot(stateRoot?: string, configuredStateRoot?: string): Promise<ReturnType<typeof pathsFor>> {
  const paths = pathsFor(stateRoot, configuredStateRoot);
  await mkdir(paths.tasksDir, { recursive: true });
  await mkdir(paths.queuesDir, { recursive: true });
  await mkdir(paths.monitorDir, { recursive: true });
  await mkdir(paths.usageDir, { recursive: true });
  if (!existsSync(paths.queuePath)) {
    await writeJson(paths.queuePath, {
      queue: "implementation",
      activeTaskId: null,
      items: [],
      updatedAt: nowIso(),
    });
  }
  return paths;
}

function taskDir(paths: ReturnType<typeof pathsFor>, taskId: string): string {
  return join(paths.tasksDir, taskId);
}

function statusPath(paths: ReturnType<typeof pathsFor>, taskId: string): string {
  return join(taskDir(paths, taskId), "status.json");
}

async function appendEvent(paths: ReturnType<typeof pathsFor>, taskId: string, event: Record<string, JsonValue>): Promise<void> {
  const eventsPath = join(taskDir(paths, taskId), "events.jsonl");
  await mkdir(dirname(eventsPath), { recursive: true });
  await writeFile(eventsPath, `${JSON.stringify({ ...event, at: nowIso() })}\n`, { encoding: "utf8", flag: "a" });
}

async function loadStatus(paths: ReturnType<typeof pathsFor>, taskId: string): Promise<TaskStatus> {
  const path = statusPath(paths, taskId);
  if (!existsSync(path)) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return readJson<TaskStatus>(path);
}

async function saveStatus(paths: ReturnType<typeof pathsFor>, status: TaskStatus): Promise<TaskStatus> {
  status.updatedAt = nowIso();
  await writeJson(statusPath(paths, status.taskId), status);
  return status;
}

async function listStatuses(paths: ReturnType<typeof pathsFor>): Promise<TaskStatus[]> {
  if (!existsSync(paths.tasksDir)) return [];
  const entries = await readdir(paths.tasksDir);
  const statuses: TaskStatus[] = [];
  for (const entry of entries) {
    const path = statusPath(paths, entry);
    try {
      if ((await stat(path)).isFile()) statuses.push(await readJson<TaskStatus>(path));
    } catch {
      // Ignore partial task directories so one bad task does not break queue inspection.
    }
  }
  return statuses.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function refreshQueue(paths: ReturnType<typeof pathsFor>): Promise<{
  queue: string;
  activeTaskId: string | null;
  items: string[];
  updatedAt: string;
}> {
  const statuses = await listStatuses(paths);
  const active = statuses.find((status) => ACTIVE_STATES.has(status.state));
  const queued = statuses.filter((status) => !TERMINAL_STATES.has(status.state) && !ACTIVE_STATES.has(status.state));
  const queue = {
    queue: "implementation",
    activeTaskId: active?.taskId ?? null,
    items: queued.map((status) => status.taskId),
    updatedAt: nowIso(),
  };
  await writeJson(paths.queuePath, queue);
  return queue;
}

function newStatus(input: {
  taskId: string;
  title: string;
  workspace: string;
  repo?: string;
  branch?: string;
  issueUrl?: string;
  requiresE2e?: boolean;
}): TaskStatus {
  const at = nowIso();
  return {
    taskId: input.taskId,
    title: input.title,
    state: "queued",
    attempt: 0,
    workspace: input.workspace,
    repo: input.repo,
    branch: input.branch,
    issueUrl: input.issueUrl,
    requiresE2e: input.requiresE2e ?? true,
    createdAt: at,
    updatedAt: at,
    worker: {
      sessionName: null,
      pid: null,
      logPath: null,
      exitCodePath: null,
    },
    review: {
      startedAt: null,
      completedAt: null,
      outcome: null,
      commentUrl: null,
      headRef: null,
    },
    manualTesting: {
      startedAt: null,
      completedAt: null,
      outcome: null,
      commentUrl: null,
    },
    usage: {
      attempts: [],
      totals: {
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        turns: 0,
      },
    },
  };
}

export default defineToolPlugin({
  id: "archie-orchestrator",
  name: "Archie Orchestrator",
  description: "Durable engineering task orchestration for OpenClaw agents.",
  configSchema: CONFIG_SCHEMA,
  tools: (tool) => [
    tool({
      name: "archie_task_init",
      description: "Create a durable Archie task directory and queued status record.",
      parameters: Type.Object({
        taskId: Type.String({ description: "Stable task id, for example PROJ-123." }),
        title: Type.String({ description: "Human-readable task title." }),
        workspace: Type.String({ description: "Repository worktree or workspace path for the worker." }),
        repo: Type.Optional(Type.String({ description: "Canonical repository path." })),
        branch: Type.Optional(Type.String({ description: "Expected worker branch name." })),
        issueUrl: Type.Optional(Type.String({ description: "Issue tracker URL." })),
        requiresE2e: Type.Optional(Type.Boolean({ description: "Whether post-worker verification should include E2E tests." })),
        request: Type.Optional(Type.String({ description: "Initial request.md content." })),
        context: Type.Optional(Type.String({ description: "Initial context.md content." })),
        acceptance: Type.Optional(Type.String({ description: "Initial acceptance.md content." })),
        reviewNotes: Type.Optional(Type.String({ description: "Initial review-notes.md content." })),
        stateRoot: Type.Optional(Type.String({ description: "Override Archie state root for this operation." })),
      }),
      execute: async (input: any, config: any) => {
        const paths = await ensureRoot(input.stateRoot, config.stateRoot);
        const dir = taskDir(paths, input.taskId);
        if (existsSync(statusPath(paths, input.taskId))) {
          throw new Error(`Task already exists: ${input.taskId}`);
        }
        await mkdir(dir, { recursive: true });
        await mkdir(join(dir, "artifacts"), { recursive: true });
        const status = await saveStatus(paths, newStatus(input));
        await writeFile(join(dir, "request.md"), input.request ?? `# Request\n\n${input.title}\n`, "utf8");
        await writeFile(join(dir, "context.md"), input.context ?? "# Context\n\n", "utf8");
        await writeFile(join(dir, "acceptance.md"), input.acceptance ?? "# Acceptance Criteria\n\n", "utf8");
        await writeFile(join(dir, "review-notes.md"), input.reviewNotes ?? "# Review Notes\n\n", "utf8");
        await appendEvent(paths, input.taskId, { type: "task_initialized", state: "queued" });
        const queue = await refreshQueue(paths);
        return { status, queue, taskDir: dir };
      },
    }),
    tool({
      name: "archie_task_read",
      description: "Read an Archie task status and task notes.",
      parameters: Type.Object({
        taskId: Type.String(),
        stateRoot: Type.Optional(Type.String()),
      }),
      execute: async ({ taskId, stateRoot }: any, config: any) => {
        const paths = await ensureRoot(stateRoot, config.stateRoot);
        const dir = taskDir(paths, taskId);
        const readText = async (name: string) => {
          const path = join(dir, name);
          return existsSync(path) ? readFile(path, "utf8") : "";
        };
        return {
          status: await loadStatus(paths, taskId),
          files: {
            request: await readText("request.md"),
            context: await readText("context.md"),
            acceptance: await readText("acceptance.md"),
            reviewNotes: await readText("review-notes.md"),
          },
        };
      },
    }),
    tool({
      name: "archie_task_transition",
      description: "Transition an Archie task through the durable lifecycle.",
      parameters: Type.Object({
        taskId: Type.String(),
        state: Type.String({ description: "Target lifecycle state." }),
        summary: Type.Optional(Type.String()),
        commentUrl: Type.Optional(Type.String()),
        headRef: Type.Optional(Type.String()),
        stateRoot: Type.Optional(Type.String()),
      }),
      execute: async ({ taskId, state, summary, commentUrl, headRef, stateRoot }: any, config: any) => {
        const paths = await ensureRoot(stateRoot, config.stateRoot);
        const status = await loadStatus(paths, taskId);
        const allowed = ALLOWED_TRANSITIONS[status.state];
        if (!allowed?.has(state)) {
          throw new Error(`Invalid transition for ${taskId}: ${status.state} -> ${state}`);
        }
        status.state = state;
        if (state === "running" || state === "retry_running") {
          status.attempt += 1;
        }
        if (state === "awaiting_review") {
          status.review.startedAt ??= nowIso();
          status.review.headRef = headRef ?? status.review.headRef;
        }
        if (state === "awaiting_manual_testing") {
          status.manualTesting.startedAt ??= nowIso();
        }
        if (state === "completed" || state === "blocked" || state === "cancelled") {
          status.review.completedAt ??= status.review.startedAt ? nowIso() : null;
          status.manualTesting.completedAt ??= status.manualTesting.startedAt ? nowIso() : null;
        }
        if (commentUrl) {
          if (state === "awaiting_manual_testing" || state === "completed") status.manualTesting.commentUrl = commentUrl;
          else status.review.commentUrl = commentUrl;
        }
        await saveStatus(paths, status);
        await appendEvent(paths, taskId, { type: "state_transition", state, summary: summary ?? null });
        const queue = await refreshQueue(paths);
        return { status, queue };
      },
    }),
    tool({
      name: "archie_queue_status",
      description: "Return active and queued Archie implementation tasks.",
      parameters: Type.Object({
        stateRoot: Type.Optional(Type.String()),
      }),
      execute: async ({ stateRoot }: any, config: any) => {
        const paths = await ensureRoot(stateRoot, config.stateRoot);
        const statuses = await listStatuses(paths);
        const queue = await refreshQueue(paths);
        return {
          queue,
          active: statuses.filter((status) => ACTIVE_STATES.has(status.state)),
          pending: statuses.filter((status) => !TERMINAL_STATES.has(status.state) && !ACTIVE_STATES.has(status.state)),
          terminal: statuses.filter((status) => TERMINAL_STATES.has(status.state)),
        };
      },
    }),
    tool({
      name: "archie_usage_report",
      description: "Summarize token/cost usage recorded in Archie task status files.",
      parameters: Type.Object({
        stateRoot: Type.Optional(Type.String()),
      }),
      execute: async ({ stateRoot }: any, config: any) => {
        const paths = await ensureRoot(stateRoot, config.stateRoot);
        const statuses = await listStatuses(paths);
        const totals = statuses.reduce(
          (acc, status) => {
            acc.tasks += 1;
            acc.costUsd += status.usage?.totals?.costUsd ?? 0;
            acc.inputTokens += status.usage?.totals?.inputTokens ?? 0;
            acc.outputTokens += status.usage?.totals?.outputTokens ?? 0;
            acc.turns += status.usage?.totals?.turns ?? 0;
            return acc;
          },
          { tasks: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 },
        );
        return {
          stateRoot: paths.root,
          totals,
          tasks: statuses.map((status) => ({
            taskId: status.taskId,
            state: status.state,
            usage: status.usage?.totals,
          })),
        };
      },
    }),
  ],
});
