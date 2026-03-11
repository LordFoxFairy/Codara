import {describe, expect, it} from 'bun:test';
import * as tasking from '@core/tasking';

describe('tasking public surface', () => {
  it('should keep TaskMiddleware as the public delegation entry', () => {
    expect('createTaskMiddleware' in tasking).toBe(true);
    expect('TASK_TOOL_NAME' in tasking).toBe(true);
    expect('createTaskTool' in tasking).toBe(false);
  });

  it('should keep subagent primitives out of the tasking barrel', () => {
    expect('createSubagentTool' in tasking).toBe(false);
    expect('createSubagentMiddleware' in tasking).toBe(false);
    expect('DEFAULT_SUBAGENT_TOOL_NAME' in tasking).toBe(false);
    expect('DEFAULT_SUBAGENT_TOOL_DESCRIPTION' in tasking).toBe(false);
    expect('readDelegatedAgentResult' in tasking).toBe(false);
  });
});
