import {describe, expect, it} from 'bun:test';
import * as tasks from '@capability/task';

describe('tasks public surface', () => {
  it('should keep TaskMiddleware as the public coordination entry', () => {
    expect('createTaskMiddleware' in tasks).toBe(true);
    expect('AGENT_TOOL_NAME' in tasks).toBe(false);
    expect('createAgentTool' in tasks).toBe(false);
  });

  it('should keep subagent primitives out of the tasks barrel', () => {
    expect('createSubagentTool' in tasks).toBe(false);
    expect('createSubagentMiddleware' in tasks).toBe(false);
    expect('DEFAULT_SUBAGENT_TOOL_NAME' in tasks).toBe(false);
    expect('DEFAULT_SUBAGENT_TOOL_DESCRIPTION' in tasks).toBe(false);
    expect('readDelegatedAgentResult' in tasks).toBe(false);
  });
});
