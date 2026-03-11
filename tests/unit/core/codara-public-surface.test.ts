import {describe, expect, it} from 'bun:test';
import * as codara from '@core/codara';

describe('Codara public surface', () => {
  it('should keep runtime planning helpers out of the public codara barrel', () => {
    expect('createCodaraRuntimePlan' in codara).toBe(false);
    expect('resolveCodaraRuntime' in codara).toBe(false);
  });

  it('should keep thin Codara tasking wrappers out of the public codara barrel', () => {
    expect('createCodaraTaskTool' in codara).toBe(false);
    expect('createCodaraTaskMiddleware' in codara).toBe(false);
    expect('createCodaraSubagentTool' in codara).toBe(false);
    expect('createCodaraSubagentMiddleware' in codara).toBe(false);
  });
});
