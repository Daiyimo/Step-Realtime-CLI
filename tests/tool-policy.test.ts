import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolPolicy } from "../packages/core/src/policy/tool-policy.js";
import type { ToolSpec } from "@step-cli/protocol";

const commandToolSpec: ToolSpec = {
  definition: {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  security: {
    risk: "execute",
    defaultMode: "confirm",
  },
  parseArgs: () => ({}),
  execute: async () => ({
    ok: true,
    summary: "ok",
    content: "",
  }),
};

function evaluateCommand(command: string) {
  const policy = new ToolPolicy({
    mode: "confirm",
    nonInteractiveApproval: "deny",
  });

  return policy.evaluate("run_command", "{}", commandToolSpec, {
    command,
  });
}

test("ToolPolicy denies encoded destructive shell commands", () => {
  const decision = evaluateCommand("bash -c 'cm0gLXJmIC8= | base64 -d | sh'");

  assert.equal(decision.mode, "deny");
  assert.match(decision.reason, /dangerous command/i);
});

test("ToolPolicy allows benign encoded text", () => {
  const decision = evaluateCommand("echo SGVsbG8=");

  assert.equal(decision.mode, "confirm");
});

test("ToolPolicy denies destructive rm paths", () => {
  const decision = evaluateCommand("rm -rf /tmp/test");

  assert.equal(decision.mode, "deny");
  assert.match(decision.reason, /dangerous command/i);
});

test("ToolPolicy denies destructive find delete variants", () => {
  const decision = evaluateCommand("find / -mindepth 1 -delete");

  assert.equal(decision.mode, "deny");
  assert.match(decision.reason, /dangerous command/i);
});

test("ToolPolicy denies destructive workspace wipe variants", () => {
  const decision = evaluateCommand("find . -mindepth 1 -delete");

  assert.equal(decision.mode, "deny");
  assert.match(decision.reason, /dangerous command/i);
});

test("ToolPolicy denies git clean forced delete variants", () => {
  const decision = evaluateCommand("git clean -fdx");

  assert.equal(decision.mode, "deny");
  assert.match(decision.reason, /dangerous command/i);
});
