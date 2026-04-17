import {describe, expect, it} from 'bun:test';
import * as tasks from '@tasks';

describe('tasks public surface', () => {
  it('should expose task tools and stores without a second outward middleware surface', () => {
    expect('createTaskMiddleware' in tasks).toBe(false);
    expect('createTaskTools' in tasks).toBe(true);
    expect('AGENT_TOOL_NAME' in tasks).toBe(false);
    expect('createSubagentTool' in tasks).toBe(false);
  });

  it('should keep subagent primitives out of the tasks barrel', () => {
    expect('createSubagentTool' in tasks).toBe(false);
    expect('createSubagentMiddleware' in tasks).toBe(false);
    expect('DEFAULT_SUBAGENT_TOOL_NAME' in tasks).toBe(false);
    expect('DEFAULT_SUBAGENT_TOOL_DESCRIPTION' in tasks).toBe(false);
    expect('readSubagentResult' in tasks).toBe(false);
  });
});
