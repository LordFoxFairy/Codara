# Agents

## Layers

- `AgentRunner`
  - Low-level execution kernel.
  - Caller provides `state.messages` explicitly on every `invoke(...)`.
  - Owns loop execution, middleware dispatch, tools, and HIL protocol handling.

- `createAgent(...)`
  - Stateful host around `AgentRunner` for terminal-style usage.
  - Owns conversation messages, runtime context, pending HIL pause state, and checkpoint boundaries.
  - Uses `threadId` + `checkpointer` instead of ad-hoc snapshots.
  - Defaults to an in-memory checkpointer when `checkpointer` is omitted.
  - Exposes `invoke(...)`, `resume(...)`, `reset()`, `dispose()`, and checkpoint helpers.

## Usage

### Default memory-backed agent

```ts
import {createAgent} from '@core/agents';

const agent = createAgent({model, tools, middlewares});

await agent.invoke('hello');
await agent.resume({action: 'allow'});

const checkpoint = await agent.saveCheckpoint();
```

### File-backed restoreable agent

```ts
import {createAgent, loadAgent} from '@core/agents';
import {createAgentFileCheckpointer} from '@core/checkpoint';

const checkpointer = createAgentFileCheckpointer({
  rootDir: '.codara/state/threads',
});

const agent = createAgent({
  model,
  tools,
  middlewares,
  threadId: 'terminal-thread',
  checkpointer,
});

await agent.invoke('hello');

const restored = await loadAgent({
  model,
  tools,
  middlewares,
  threadId: 'terminal-thread',
  checkpointer,
});
```

## Checkpoint vs Memory

- Checkpoint
  - Captures stable agent boundaries as `threadId/checkpointId/state/info`.
  - Default mode is in-memory; file persistence is available through `FileCheckpointer`.
  - Agent-specific persisted state lives in `src/core/checkpoint/state.ts`, not under `agents/`.
  - File persistence stores a single `latest.json` head pointer plus immutable `checkpoints/*.json` records.
  - Used for restore/recovery, not for long-term semantic memory.

- Memory
  - Not implemented in this layer.
  - Short-term memory is already covered by `messages` and agent runtime context.
  - Long-term/project memory should stay as a separate concern from checkpoints.
