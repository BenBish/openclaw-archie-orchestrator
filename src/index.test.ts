import { describe, expect, it } from "vitest";
import entry from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

describe("archie-orchestrator", () => {
  it("declares tool metadata", () => {
    expect(getToolPluginMetadata(entry)?.tools.map((tool) => tool.name)).toEqual([
      "archie_task_init",
      "archie_task_read",
      "archie_task_transition",
      "archie_queue_status",
      "archie_usage_report",
    ]);
  });
});
