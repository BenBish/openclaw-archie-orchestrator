import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import entry, { _toolExecutors } from "./index.js";

let stateRoot: string;
beforeEach(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), "archie-test-"));
});
afterEach(async () => {
  await rm(stateRoot, { recursive: true, force: true });
});

function exec(name: string, input: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
  return _toolExecutors[name]({ ...input, stateRoot }, config);
}

async function initTask(taskId = "TASK-1", overrides: Record<string, unknown> = {}) {
  return exec("archie_task_init", { taskId, title: "Test task", workspace: "/tmp/ws", ...overrides });
}

async function transition(taskId: string, state: string, extras: Record<string, unknown> = {}) {
  return exec("archie_task_transition", { taskId, state, ...extras });
}

// Advance a task to a specific state through required intermediaries.
async function advanceTo(taskId: string, targetState: string) {
  const path = [
    "queued",
    "preparing",
    "running",
    "awaiting_worker_exit_reconcile",
    "awaiting_review",
    "awaiting_manual_testing",
    "completed",
  ];
  const idx = path.indexOf(targetState);
  for (let i = 1; i <= idx; i++) {
    await transition(taskId, path[i]);
  }
}

// ─── metadata contract ────────────────────────────────────────────────────────

describe("metadata contract", () => {
  it("declares all tool names in order", () => {
    expect(getToolPluginMetadata(entry)?.tools.map((t) => t.name)).toEqual([
      "archie_task_init",
      "archie_task_read",
      "archie_task_transition",
      "archie_task_start",
      "archie_task_finish",
      "archie_task_update",
      "archie_queue_status",
      "archie_usage_report",
    ]);
  });

  it("declares lifecycle state enum metadata", () => {
    const transitionTool = getToolPluginMetadata(entry)?.tools.find((t) => t.name === "archie_task_transition");
    expect(transitionTool?.parameters.properties?.state).toMatchObject({
      type: "string",
      enum: expect.arrayContaining(["queued", "running", "completed"]),
    });
  });
});

// ─── archie_task_init ─────────────────────────────────────────────────────────

describe("archie_task_init", () => {
  it("creates a queued status record with correct fields", async () => {
    const { status } = await initTask("PROJ-1");
    expect(status.taskId).toBe("PROJ-1");
    expect(status.title).toBe("Test task");
    expect(status.state).toBe("queued");
    expect(status.attempt).toBe(0);
    expect(status.workspace).toBe("/tmp/ws");
    expect(status.requiresE2e).toBe(true);
    expect(status.worker).toEqual({ sessionName: null, pid: null, logPath: null, exitCodePath: null });
    expect(status.review).toMatchObject({ startedAt: null, completedAt: null, outcome: null, commentUrl: null, headRef: null });
    expect(status.manualTesting).toMatchObject({ startedAt: null, completedAt: null, outcome: null, commentUrl: null });
    expect(status.usage.totals).toEqual({ costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 });
  });

  it("returns stateRoot and lifecycle guidance", async () => {
    const result = await initTask("PROJ-GUIDE");
    expect(result.stateRoot).toBe(stateRoot);
    expect(result.allowedNextStates).toEqual(["preparing", "cancelled"]);
    expect(result.suggestedNextTools).toContain("archie_task_start");
  });

  it("initialises the queue with no active task", async () => {
    const { queue } = await initTask("PROJ-1");
    expect(queue.activeTaskId).toBeNull();
  });

  it("creates default markdown files", async () => {
    const { taskDir: dir } = await initTask("PROJ-2");
    const request = await readFile(join(dir, "request.md"), "utf8");
    const context = await readFile(join(dir, "context.md"), "utf8");
    const acceptance = await readFile(join(dir, "acceptance.md"), "utf8");
    const reviewNotes = await readFile(join(dir, "review-notes.md"), "utf8");
    expect(request).toContain("Test task");
    expect(context).toContain("# Context");
    expect(acceptance).toContain("# Acceptance");
    expect(reviewNotes).toContain("# Review Notes");
  });

  it("persists custom file content", async () => {
    const { taskDir: dir } = await initTask("PROJ-3", {
      request: "my request",
      context: "my context",
      acceptance: "my acceptance",
      reviewNotes: "my review notes",
    });
    expect(await readFile(join(dir, "request.md"), "utf8")).toBe("my request");
    expect(await readFile(join(dir, "context.md"), "utf8")).toBe("my context");
    expect(await readFile(join(dir, "acceptance.md"), "utf8")).toBe("my acceptance");
    expect(await readFile(join(dir, "review-notes.md"), "utf8")).toBe("my review notes");
  });

  it("stores optional fields when provided", async () => {
    const { status } = await initTask("PROJ-4", {
      repo: "/repos/myapp",
      branch: "feature/foo",
      issueUrl: "https://linear.app/issue/PROJ-4",
      requiresE2e: false,
    });
    expect(status.repo).toBe("/repos/myapp");
    expect(status.branch).toBe("feature/foo");
    expect(status.issueUrl).toBe("https://linear.app/issue/PROJ-4");
    expect(status.requiresE2e).toBe(false);
  });

  it("throws when the same taskId is initialised twice", async () => {
    await initTask("DUP-1");
    await expect(initTask("DUP-1")).rejects.toThrow("Task already exists: DUP-1");
  });
});

// ─── archie_task_read ─────────────────────────────────────────────────────────

describe("archie_task_read", () => {
  it("returns status and file contents for an existing task", async () => {
    await initTask("READ-1", { request: "the request" });
    const result = await exec("archie_task_read", { taskId: "READ-1" });
    expect(result.status.taskId).toBe("READ-1");
    expect(result.files.request).toBe("the request");
    expect(result.files.context).toContain("# Context");
    expect(result.stateRoot).toBe(stateRoot);
    expect(result.allowedNextStates).toEqual(["preparing", "cancelled"]);
  });

  it("throws for an unknown taskId", async () => {
    await expect(exec("archie_task_read", { taskId: "NO-SUCH" })).rejects.toThrow("Task not found: NO-SUCH");
  });

  it("returns empty string for a missing optional file", async () => {
    const { taskDir: dir } = await initTask("READ-2");
    // Remove one file to simulate partial task directory.
    await rm(join(dir, "context.md"));
    const result = await exec("archie_task_read", { taskId: "READ-2" });
    expect(result.files.context).toBe("");
  });
});

// ─── archie_task_transition ───────────────────────────────────────────────────

describe("archie_task_transition", () => {
  it("queued → preparing does not increment attempt", async () => {
    await initTask("TR-1");
    const { status } = await transition("TR-1", "preparing");
    expect(status.state).toBe("preparing");
    expect(status.attempt).toBe(0);
  });

  it("preparing → running increments attempt to 1", async () => {
    await initTask("TR-2");
    await transition("TR-2", "preparing");
    const { status } = await transition("TR-2", "running");
    expect(status.attempt).toBe(1);
  });

  it("retry_running increments attempt again", async () => {
    await initTask("TR-3");
    await advanceTo("TR-3", "awaiting_review");
    await transition("TR-3", "retry_planned");
    const { status } = await transition("TR-3", "retry_running");
    expect(status.attempt).toBe(2);
  });

  it("throws for an invalid transition", async () => {
    await initTask("TR-4");
    await expect(transition("TR-4", "completed")).rejects.toThrow(
      "Invalid transition for TR-4: queued -> completed. Allowed next states: preparing, cancelled.",
    );
  });

  it("sets review.startedAt on first entry to awaiting_review", async () => {
    await initTask("TR-5");
    await advanceTo("TR-5", "awaiting_review");
    const { status } = await exec("archie_task_read", { taskId: "TR-5" });
    expect(status.review.startedAt).not.toBeNull();
  });

  it("does not overwrite review.startedAt on re-entry", async () => {
    await initTask("TR-6");
    await advanceTo("TR-6", "awaiting_review");
    const { status: first } = await exec("archie_task_read", { taskId: "TR-6" });
    const firstStartedAt = first.review.startedAt;
    // retry loop back to awaiting_review
    await transition("TR-6", "retry_planned");
    await transition("TR-6", "retry_running");
    await transition("TR-6", "awaiting_worker_exit_reconcile");
    await transition("TR-6", "awaiting_review");
    const { status: second } = await exec("archie_task_read", { taskId: "TR-6" });
    expect(second.review.startedAt).toBe(firstStartedAt);
  });

  it("stores headRef when transitioning to awaiting_review", async () => {
    await initTask("TR-7b");
    await transition("TR-7b", "preparing");
    await transition("TR-7b", "running");
    await transition("TR-7b", "awaiting_worker_exit_reconcile");
    const { status } = await transition("TR-7b", "awaiting_review", { headRef: "feature/my-branch" });
    expect(status.review.headRef).toBe("feature/my-branch");
  });

  it("auto-closes timestamps on completed", async () => {
    await initTask("TR-8");
    await advanceTo("TR-8", "awaiting_manual_testing");
    const { status } = await transition("TR-8", "completed");
    expect(status.review.completedAt).not.toBeNull();
    expect(status.manualTesting.completedAt).not.toBeNull();
  });

  it("auto-closes timestamps on blocked via retry_planned", async () => {
    await initTask("TR-9");
    await advanceTo("TR-9", "awaiting_review");
    await transition("TR-9", "retry_planned");
    const { status } = await transition("TR-9", "blocked");
    expect(status.review.completedAt).not.toBeNull();
  });

  it("routes commentUrl to review when transitioning to awaiting_review", async () => {
    await initTask("TR-10");
    await transition("TR-10", "preparing");
    await transition("TR-10", "running");
    await transition("TR-10", "awaiting_worker_exit_reconcile");
    const { status } = await transition("TR-10", "awaiting_review", { commentUrl: "https://github.com/pr/1" });
    expect(status.review.commentUrl).toBe("https://github.com/pr/1");
    expect(status.manualTesting.commentUrl).toBeNull();
  });

  it("routes commentUrl to manualTesting when transitioning to awaiting_manual_testing", async () => {
    await initTask("TR-11");
    await advanceTo("TR-11", "awaiting_review");
    const { status } = await transition("TR-11", "awaiting_manual_testing", { commentUrl: "https://github.com/pr/2" });
    expect(status.manualTesting.commentUrl).toBe("https://github.com/pr/2");
    expect(status.review.commentUrl).toBeNull();
  });

  it("routes commentUrl to manualTesting when cancelling FROM awaiting_manual_testing (regression)", async () => {
    await initTask("TR-12");
    await advanceTo("TR-12", "awaiting_manual_testing");
    const { status } = await transition("TR-12", "cancelled", { commentUrl: "https://github.com/pr/3" });
    expect(status.manualTesting.commentUrl).toBe("https://github.com/pr/3");
    expect(status.review.commentUrl).toBeNull();
  });

  it("writes outcome to review.outcome for review-phase transitions", async () => {
    await initTask("TR-13");
    await advanceTo("TR-13", "awaiting_review");
    const { status } = await transition("TR-13", "completed", { outcome: "approved" });
    expect(status.review.outcome).toBe("approved");
    expect(status.manualTesting.outcome).toBeNull();
  });

  it("writes outcome to manualTesting.outcome for manual-testing-phase transitions", async () => {
    await initTask("TR-14");
    await advanceTo("TR-14", "awaiting_manual_testing");
    const { status } = await transition("TR-14", "completed", { outcome: "passed" });
    expect(status.manualTesting.outcome).toBe("passed");
  });

  it("writes outcome to manualTesting.outcome when cancelling FROM awaiting_manual_testing", async () => {
    await initTask("TR-15");
    await advanceTo("TR-15", "awaiting_manual_testing");
    const { status } = await transition("TR-15", "cancelled", { outcome: "failed" });
    expect(status.manualTesting.outcome).toBe("failed");
    expect(status.review.outcome).toBeNull();
  });
});

// ─── archie_task_start ────────────────────────────────────────────────────────

describe("archie_task_start", () => {
  it("walks queued tasks to running", async () => {
    await initTask("START-1");
    const { status, allowedNextStates, suggestedNextTools } = await exec("archie_task_start", { taskId: "START-1" });
    expect(status.state).toBe("running");
    expect(status.attempt).toBe(1);
    expect(allowedNextStates).toEqual(["awaiting_worker_exit_reconcile", "cancelled"]);
    expect(suggestedNextTools).toContain("archie_task_finish");
  });

  it("is safe to call for an already running task", async () => {
    await initTask("START-2");
    await exec("archie_task_start", { taskId: "START-2" });
    const { status } = await exec("archie_task_start", { taskId: "START-2" });
    expect(status.state).toBe("running");
    expect(status.attempt).toBe(1);
  });

  it("rejects terminal tasks", async () => {
    await initTask("START-3");
    await exec("archie_task_finish", { taskId: "START-3", result: "completed" });
    await expect(exec("archie_task_start", { taskId: "START-3" })).rejects.toThrow("Cannot start START-3: task is already terminal (completed).");
  });
});

// ─── archie_task_finish ───────────────────────────────────────────────────────

describe("archie_task_finish", () => {
  it("walks queued tasks to completed", async () => {
    await initTask("FIN-1");
    const { status, queue } = await exec("archie_task_finish", { taskId: "FIN-1", result: "completed", outcome: "passed" });
    expect(status.state).toBe("completed");
    expect(status.attempt).toBe(1);
    expect(status.review.outcome).toBe("passed");
    expect(queue.items).toEqual([]);
  });

  it("walks running tasks to blocked", async () => {
    await initTask("FIN-2");
    await exec("archie_task_start", { taskId: "FIN-2" });
    const { status } = await exec("archie_task_finish", { taskId: "FIN-2", result: "blocked", outcome: "failed" });
    expect(status.state).toBe("blocked");
    expect(status.review.outcome).toBe("failed");
  });

  it("cancels a queued task", async () => {
    await initTask("FIN-3");
    const { status } = await exec("archie_task_finish", { taskId: "FIN-3", result: "cancelled" });
    expect(status.state).toBe("cancelled");
  });

  it("returns terminal tasks unchanged", async () => {
    await initTask("FIN-4");
    await exec("archie_task_finish", { taskId: "FIN-4", result: "completed" });
    const { status } = await exec("archie_task_finish", { taskId: "FIN-4", result: "completed" });
    expect(status.state).toBe("completed");
    expect(status.attempt).toBe(1);
  });

  it("records each auto-transition event", async () => {
    const { taskDir: dir } = await initTask("FIN-5");
    await exec("archie_task_finish", { taskId: "FIN-5", result: "completed" });
    const events = (await readFile(join(dir, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.state).filter(Boolean)).toEqual([
      "queued",
      "preparing",
      "running",
      "awaiting_worker_exit_reconcile",
      "awaiting_review",
      "completed",
    ]);
  });
});

// ─── archie_queue_status ──────────────────────────────────────────────────────

describe("archie_queue_status", () => {
  it("returns empty buckets for a fresh state root", async () => {
    const result = await exec("archie_queue_status");
    expect(result.stateRoot).toBe(stateRoot);
    expect(result.active).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
    expect(result.terminal).toHaveLength(0);
    expect(result.queue.activeTaskId).toBeNull();
    expect(result.diagnostics).toEqual([]);
  });

  it("reflects active task once running", async () => {
    await initTask("Q-1");
    await transition("Q-1", "preparing");
    await transition("Q-1", "running");
    const result = await exec("archie_queue_status");
    expect(result.active).toHaveLength(1);
    expect(result.active[0].taskId).toBe("Q-1");
    expect(result.queue.activeTaskId).toBe("Q-1");
  });

  it("moves task to terminal bucket on completion", async () => {
    await initTask("Q-2");
    await advanceTo("Q-2", "awaiting_review");
    await transition("Q-2", "completed");
    const result = await exec("archie_queue_status");
    expect(result.active).toHaveLength(0);
    expect(result.terminal).toHaveLength(1);
    expect(result.terminal[0].taskId).toBe("Q-2");
  });

  it("keeps queued tasks in pending bucket", async () => {
    await initTask("Q-3");
    await initTask("Q-4");
    const result = await exec("archie_queue_status");
    expect(result.pending).toHaveLength(2);
    const ids = result.pending.map((t: { taskId: string }) => t.taskId);
    expect(ids).toContain("Q-3");
    expect(ids).toContain("Q-4");
  });

  it("reports malformed task diagnostics without crashing", async () => {
    const dir = join(stateRoot, "tasks", "BAD-1");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "status.json"), JSON.stringify({ state: "queued" }), "utf8");
    await initTask("Q-5");
    const result = await exec("archie_queue_status");
    expect(result.pending.map((t: { taskId: string }) => t.taskId)).toContain("Q-5");
    expect(result.diagnostics).toEqual([{ taskId: "BAD-1", reason: "status.json is missing taskId or state" }]);
  });
});

// ─── archie_usage_report ──────────────────────────────────────────────────────

describe("archie_usage_report", () => {
  it("returns zero totals for a fresh state root", async () => {
    const result = await exec("archie_usage_report");
    expect(result.totals).toEqual({ tasks: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 });
  });

  it("lists tasks with their usage", async () => {
    await initTask("U-1");
    const result = await exec("archie_usage_report");
    expect(result.totals.tasks).toBe(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].taskId).toBe("U-1");
    expect(result.tasks[0].usage).toEqual({ costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 });
  });

  it("reports correct stateRoot", async () => {
    const result = await exec("archie_usage_report");
    expect(result.stateRoot).toBe(stateRoot);
  });

  it("includes malformed task diagnostics", async () => {
    const dir = join(stateRoot, "tasks", "BAD-USAGE");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "status.json"), "{", "utf8");
    const result = await exec("archie_usage_report");
    expect(result.diagnostics[0].taskId).toBe("BAD-USAGE");
  });
});

// ─── archie_task_update ───────────────────────────────────────────────────────

describe("archie_task_update", () => {
  it("updates only the files specified", async () => {
    const { taskDir: dir } = await initTask("UPD-1", { context: "original context" });
    await exec("archie_task_update", { taskId: "UPD-1", context: "updated context" });
    expect(await readFile(join(dir, "context.md"), "utf8")).toBe("updated context");
    // request.md should be untouched
    expect(await readFile(join(dir, "request.md"), "utf8")).toContain("Test task");
  });

  it("can update all four files at once", async () => {
    const { taskDir: dir } = await initTask("UPD-2");
    const { updated } = await exec("archie_task_update", {
      taskId: "UPD-2",
      request: "r",
      context: "c",
      acceptance: "a",
      reviewNotes: "rn",
    });
    expect(updated).toEqual(["request", "context", "acceptance", "reviewNotes"]);
    expect(await readFile(join(dir, "request.md"), "utf8")).toBe("r");
    expect(await readFile(join(dir, "context.md"), "utf8")).toBe("c");
    expect(await readFile(join(dir, "acceptance.md"), "utf8")).toBe("a");
    expect(await readFile(join(dir, "review-notes.md"), "utf8")).toBe("rn");
  });

  it("returns empty updated array when no files are specified", async () => {
    await initTask("UPD-3");
    const { updated } = await exec("archie_task_update", { taskId: "UPD-3" });
    expect(updated).toEqual([]);
  });

  it("throws for an unknown taskId", async () => {
    await expect(exec("archie_task_update", { taskId: "NO-SUCH", context: "x" })).rejects.toThrow("Task not found: NO-SUCH");
  });

  it("appends a task_updated event", async () => {
    const { taskDir: dir } = await initTask("UPD-4");
    await exec("archie_task_update", { taskId: "UPD-4", request: "new request" });
    const events = await readFile(join(dir, "events.jsonl"), "utf8");
    const lines = events.trim().split("\n").map((l) => JSON.parse(l));
    const updateEvent = lines.find((e: { type: string }) => e.type === "task_updated");
    expect(updateEvent).toBeDefined();
    expect(updateEvent.files).toContain("request");
  });
});
