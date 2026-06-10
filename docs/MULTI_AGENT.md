# Multi-Agent Architecture

Step Realtime CLI supports three agent flavors that can operate concurrently, enabling delegation, parallelism, and team collaboration.

## Overview

```
┌─────────────────────────────────────────────────────┐
│                   Main Agent (depth 0)               │
│  Interactive priority · Session memory · User-facing │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  Subagent     │  │  Subagent     │  │ Teammate   │ │
│  │  (sync task)  │  │  (background) │  │ (persist)  │ │
│  │  depth=1      │  │  depth=1      │  │ depth=1    │ │
│  │  fresh memory │  │  fresh mem    │  │ persist mem│ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│         ↑ blocked        ↑ async         ↑ inbox     │
└─────────────────────────────────────────────────────┘
```

|                   | Main          | Subagent (sync)    | Subagent (background)      | Teammate       |
| ----------------- | ------------- | ------------------ | -------------------------- | -------------- |
| **Depth**         | 0             | 1                  | 1                          | 1              |
| **Priority**      | interactive   | delegated          | background                 | background     |
| **Memory**        | session       | fresh              | fresh                      | persistent     |
| **Workspace**     | shared        | shared or isolated | shared or isolated         | shared         |
| **Lifecycle**     | session-bound | single turn        | multi-turn (queued)        | session-bound  |
| **Communication** | user ↔ agent  | result return      | notifications + follow-ups | inbox messages |

## Agent Flavors

### Main Agent

The user-facing interactive agent. Runs at depth 0 with interactive priority, meaning it gets first access to model resources and user attention. Holds session-scoped conversation memory.

### Subagent — Synchronous (`task`)

A one-shot agent that blocks the main agent until completion. Created via the `task` tool:

```
task({ prompt: "Refactor the auth module", preset: "general" })
```

- Inherits parent context when `context_mode: "inherit"` (passes parent memory snapshot).
- Can use isolated workspace via `isolate_workspace: true` (creates a git worktree).
- Returns the final result directly to the main agent.

### Subagent — Background (`task_start`)

An asynchronous agent that runs in the background while the main agent continues working:

```
task_start({ prompt: "Search for security issues", alias: "sec-audit", group: "audit" })
task_reply({ task_id: "...", prompt: "Also check the auth module" })
task_wait({ group: "audit", mode: "all", timeout: 30 })
```

- Up to 48 concurrent background subtasks.
- Supports `alias` (stable handle) and `group` (orchestration grouping).
- Main agent receives notifications automatically (capped at 6 per model request).
- `task_list` inspects all running/completed subtasks.

### Teammate

A persistent, long-lived agent that communicates via asynchronous inbox messages:

```
# Spawning
spawnTeammate({ name: "researcher", role: "Find relevant code", preset: "explore" })

# Communication
sendMessage({ to: "researcher", content: "Check the new PR" })
readInbox({ inbox: "lead" })
```

- Runs a background worker loop that polls its inbox (800ms interval).
- After each turn, sends an announcement back to the lead's inbox.
- Supports protocol requests: `requestShutdown`, `requestPlanApproval`.
- Mandatory inbox tools: `send_message`, `read_inbox`, `request_plan_approval`, `respond_shutdown`.

## Execution Profiles

Each agent kind has a default execution profile:

```typescript
main:     { workspaceMode: "shared",    memoryMode: "session",     priority: "interactive" }
subagent: { workspaceMode: "shared",    memoryMode: "fresh",       priority: "delegated" }
teammate: { workspaceMode: "shared",    memoryMode: "persistent",  priority: "background" }
```

Overrides can be applied via presets or explicitly at spawn time.

## Agent Presets

Built-in named configuration templates that customize agent behavior:

| Preset    | Subagent role | Teammate role | Focus                            |
| --------- | ------------- | ------------- | -------------------------------- |
| `general` | generalist    | generalist    | Broad implementation             |
| `explore` | researcher    | researcher    | Discovery and evidence gathering |
| `review`  | reviewer      | reviewer      | Read-only reviewing              |
| `planner` | planner       | planner       | Decomposition and sequencing     |

Presets can customize: system prompt appendix, allowed tools, execution profile overrides.

User-defined presets can be added via config (`StepCliAgentPresetConfig`).

## Delegation View

The UI overlay normalizes all three delegation kinds into a unified view:

```
TeammatesOverlaySnapshot
├── summary: { teammates: {total, working, idle, error, shutdown},
│              background: {total, running, queued, problem} }
├── teammates: TeammateDelegationView[]
├── subtasks: SubtaskDelegationView[]
├── backgroundCommands: BackgroundCommandDelegationView[]
├── planRequests: TeamProtocolRequest[]
└── shutdownRequests: TeamProtocolRequest[]
```

Each `DelegationView` exposes action affordances (`reply`, `interrupt`, `waitReady`) that the UI can render as buttons or shortcuts.

## Agent SDK

The `@step-cli/agent-sdk` package provides a programmatic API for driving agent sessions:

```typescript
import { query, tool, createSdkMcpServer } from "@step-cli/agent-sdk";

// Register in-process MCP tools
const mcpServer = createSdkMcpServer({
  name: "my-tools",
  tools: [
    tool(
      "greet",
      "Say hello",
      { type: "object", properties: { name: { type: "string" } } },
      async ({ name }) => `Hello, ${name}!`,
    ),
  ],
});

// Run an agent session
const result = query({
  prompt: "Greet the user",
  model: "step/native",
  mcpServers: { "my-tools": mcpServer },
});

for await (const msg of result) {
  console.log(msg.type, msg);
}
```

### SDK Components

| Component         | Purpose                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| `OutboundQueue`   | Bounded async FIFO (1024) from agent → host; evicts stale stream deltas when full |
| `SessionStore`    | LRU cache (128 sessions, 1h TTL) for conversation memory persistence              |
| `EventTranslator` | Converts `AgentLoop` hooks into `SDKMessage` events                               |
| `MCP In-Process`  | Register tools without a separate server process                                  |
| `InputQueue`      | Priority-aware input: `"now"` messages injected before next model call            |
| `Query`           | Top-level entry: returns `AsyncIterable<SDKMessage>`                              |

## State Machine

Every agent tracks its execution lifecycle through states:

```
goal_start → prepare_context → before_model_request_hooks → context_compaction
  → model_request → tool_execution → apply_tool_results → final_response → goal_complete
```

Transitions are recorded in a timeline (capped at 200 entries) with timestamps, step counts, and tool call counts. The state machine auto-captures harness context via `AsyncLocalStorage`.

## Session Persistence

All agent state is serializable:

- `AgentTeam.exportState()` — snapshots all teammate harnesses, cursors, and protocol requests.
- `BackgroundSubtaskManager.exportState()` — snapshots all background subtask records.
- `SessionStore` — persists conversation memory for SDK session resumption.

On session restore, in-flight background tasks are marked as `"lost"` to prevent stale worker resumption.

## Depth Guard

Subagent spawning has a hard depth limit of 1 — only the main agent (depth 0) can spawn subagents. Nested subagents are prevented at the tool level via `requireTopLevelHarness()`.

## Key Files

| Component                 | Path                                                    |
| ------------------------- | ------------------------------------------------------- |
| Harness factory & harness | `packages/core/src/agent/harness.ts`                    |
| Agent loop                | `packages/core/src/agent/agent-loop.ts`                 |
| State machine             | `packages/core/src/agent/state-machine.ts`              |
| Delegation view           | `packages/core/src/agent/delegation-view.ts`            |
| Agent team                | `packages/core/src/agent/agent-team.ts`                 |
| Agent presets             | `packages/core/src/agent/agent-presets.ts`              |
| Harness context           | `packages/core/src/agent/harness-context.ts`            |
| Subagent plugin           | `skills/builtin/src/subagent-plugin.ts`                 |
| Background subtask types  | `packages/core/src/plugins/subagent-state.ts`           |
| Background command types  | `packages/core/src/plugins/background-tasks-types.ts`   |
| Team inbox store          | `src/gateway/team/filesystem-agent-team-inbox-store.ts` |
| Agent SDK query           | `packages/agent-sdk/src/query.ts`                       |
| Agent SDK outbound        | `packages/agent-sdk/src/outbound-queue.ts`              |
| Agent SDK session         | `packages/agent-sdk/src/session-store.ts`               |
| Agent SDK events          | `packages/agent-sdk/src/event-translator.ts`            |
| Agent SDK MCP             | `packages/agent-sdk/src/mcp-inproc.ts`                  |
| Agent SDK input           | `packages/agent-sdk/src/input-queue.ts`                 |
