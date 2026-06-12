import { describe, expect, it } from "vitest";
import { createSwarmPlugin } from "./swarm-plugin.js";

describe("createSwarmPlugin", () => {
  it("starts inactive", () => {
    const plugin = createSwarmPlugin();
    expect(plugin.getSwarmMode().isActive).toBe(false);
    expect(plugin.getSwarmMode().trigger).toBeNull();
  });

  it("enters mode and injects reminder for main harness", () => {
    const plugin = createSwarmPlugin();
    const mode = plugin.getSwarmMode();
    mode.enter("manual");
    expect(mode.isActive).toBe(true);
    expect(mode.trigger).toBe("manual");

    const hook = plugin.hooks.beforeModelRequest?.({
      workspaceRoot: "/tmp",
      step: 1,
      toolCalls: 0,
      now: new Date().toISOString(),
      userMessages: [],
      harnessType: "main",
      harnessDepth: 0,
    });
    expect(hook?.messages?.length).toBe(1);
    expect(hook?.messages?.[0]?.role).toBe("system");
    expect(hook?.messages?.[0]?.content).toContain("Swarm Mode");
  });

  it("is idempotent on double enter", () => {
    const plugin = createSwarmPlugin();
    const mode = plugin.getSwarmMode();
    mode.enter("manual");
    mode.enter("manual");
    expect(mode.isActive).toBe(true);
    const hook = plugin.hooks.beforeModelRequest?.({
      workspaceRoot: "/tmp",
      step: 1,
      toolCalls: 0,
      now: new Date().toISOString(),
      userMessages: [],
      harnessType: "main",
      harnessDepth: 0,
    });
    expect(hook?.messages?.length).toBe(1);
  });

  it("dedupes repeated prompt for same trigger", () => {
    const plugin = createSwarmPlugin();
    const mode = plugin.getSwarmMode();
    mode.enter("task", "review src/");
    mode.exit();
    mode.enter("task", "review src/");
    expect(mode.trigger).toBeNull();
  });

  it("allows same trigger with different prompt", () => {
    const plugin = createSwarmPlugin();
    const mode = plugin.getSwarmMode();
    mode.enter("task", "review src/a.ts");
    mode.exit();
    mode.enter("task", "review src/b.ts");
    expect(mode.trigger).toBe("task");
  });

  it("exits and stops injecting", () => {
    const plugin = createSwarmPlugin();
    const mode = plugin.getSwarmMode();
    mode.enter("manual");
    mode.exit();
    expect(mode.isActive).toBe(false);
    const hook = plugin.hooks.beforeModelRequest?.({
      harnessType: "main",
      harnessDepth: 0,
    } as never);
    expect(hook?.messages?.length).toBeUndefined();
  });

  it("does not inject for non-main harness", () => {
    const plugin = createSwarmPlugin();
    plugin.getSwarmMode().enter("manual");
    const hook = plugin.hooks.beforeModelRequest?.({
      workspaceRoot: "/tmp",
      step: 1,
      toolCalls: 0,
      now: new Date().toISOString(),
      userMessages: [],
      harnessType: "teammate",
      harnessDepth: 1,
    });
    expect(hook?.messages?.length).toBeUndefined();
  });

  it("does not inject for deep main harness", () => {
    const plugin = createSwarmPlugin();
    plugin.getSwarmMode().enter("manual");
    const hook = plugin.hooks.beforeModelRequest?.({
      workspaceRoot: "/tmp",
      step: 1,
      toolCalls: 0,
      now: new Date().toISOString(),
      userMessages: [],
      harnessType: "main",
      harnessDepth: 2,
    });
    expect(hook?.messages?.length).toBeUndefined();
  });
});
