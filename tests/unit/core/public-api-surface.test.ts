import {describe, expect, it} from 'bun:test';
import * as core from '@/index';
import * as api from '../../../src/index';

describe('core public APIs', () => {
  it('should expose TaskMiddleware as the public delegation entry', () => {
    expect('createTaskMiddleware' in core).toBe(true);
    expect('createTaskMiddleware' in api).toBe(true);
  });

  it('should keep subagent primitives out of root and @core public barrels', () => {
    expect('createSubagentTool' in core).toBe(false);
    expect('createSubagentMiddleware' in core).toBe(false);
    expect('DEFAULT_SUBAGENT_TOOL_NAME' in core).toBe(false);
    expect('DEFAULT_SUBAGENT_TOOL_DESCRIPTION' in core).toBe(false);

    expect('createSubagentTool' in api).toBe(false);
    expect('createSubagentMiddleware' in api).toBe(false);
  });

  it('should keep low-level task tools out of the top-level public barrels', () => {
    expect('createAgentTool' in core).toBe(false);
    expect('createAgentTool' in api).toBe(false);
  });

  it('should expose source constructors in the advanced public barrels', () => {
    expect('createCodaraGuidelinesSource' in core).toBe(true);
    expect('createCodaraSkillsSource' in core).toBe(true);
    expect('createSourceTurnContextPreparer' in core).toBe(false);

    expect('createCodaraGuidelinesSource' in api).toBe(true);
    expect('createCodaraSkillsSource' in api).toBe(true);
    expect('createSourceTurnContextPreparer' in api).toBe(false);
  });
});
