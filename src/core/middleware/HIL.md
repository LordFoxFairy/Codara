# HIL Protocol

Codara has one generic HIL protocol.

HIL is not a permission-specific feature and it is not a clarification-specific feature. It is the shared pause/resume contract used whenever runtime execution needs user input before continuing.

## What HIL Owns

- pause a running tool call
- describe what is blocked
- declare the available review actions
- carry UI rendering hints
- accept a structured resume payload

HIL does not own business policy. Permission, requirement clarification, edit-review, or future approval flows plug into the same protocol.

When an agent needs structured user input, prefer an intent-level entry such as `AskUser` instead of having the agent author raw HIL payloads directly. Middleware can translate that intent into the shared HIL pause contract.

## Stable UI Shapes

HIL should stay shape-driven instead of accumulating explicit renderer enums.

- standard action review
  - use shared `review` data plus optional `ui.actions`
- structured multi-step or multi-tab input
  - use `ui.form`

If a future flow is only a variation of one of these, extend the existing shape instead of inventing another side protocol or another `ui.type` value.

## Core Shapes

`PauseRequest` is the runtime pause object.

```ts
interface PauseRequest {
  id: string;
  description: string;
  action: {
    toolCallId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
  };
  review: {
    actionName: string;
    allowedDecisions: Array<'approve' | 'edit' | 'reject'>;
  };
  runtime: {
    runId: string;
    turn: number;
    requestId: string;
    toolIndex: number;
  };
  channel?: string;
  ui?: PauseUIConfig;
  metadata?: Record<string, unknown>;
}
```

`PauseRequest.ui` carries display hints, not policy.

interface PauseUIConfig {
  tab?: string;
  modal?: string;
  actions?: PauseUIActionOption[];
  form?: {
    summary?: string;
    tabs: Array<{
      id: string;
      label: string;
      question: string;
      options?: Array<{
        id: string;
        label: string;
        description?: string;
      }>;
      placeholder?: string;
    }>;
  };
}
```

## Resume Payload

Hosts resume HIL with a generic payload:

```ts
interface HILResumeActionPayload {
  decision?: 'approve' | 'edit' | 'reject';
  action?: string;
  scope?: string;
  comment?: string;
  editedToolName?: string;
  editedToolArgs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

Recommended conventions:

- use `action` for the selected UI action id
- use `scope` only when business policy needs it, such as permission persistence
- use `metadata.form.answers` for structured form submissions
- keep permission-specific fields out of the HIL core types

## Owner Boundaries

- `core/middleware/hil.ts`
  - pause/resume protocol
- `core/middleware/permission/*`
  - permission policy and persistence
- CLI or other hosts
  - render the shared HIL UI from `ui.form` and `ui.actions`
  - submit resume payload

That means:

- permission uses HIL
- clarification uses HIL
- neither one gets its own second HIL abstraction

## Trigger Guidance

Use the standard review shape when runtime already knows the action and only needs a decision.

Use `ui.form` when runtime is blocked on structured user input and plain chat would be too ambiguous or too expensive to continue safely.

Examples:

- permission review before a guarded write command: review data + `ui.actions`
- product scoping or requirement intake before creating a plan: `ui.form`
