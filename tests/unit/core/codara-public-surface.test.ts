import {describe, expect, it} from 'bun:test';
import * as codara from '@core/codara';

describe('Codara public surface', () => {
  it('should keep runtime planning helpers out of the public codara barrel', () => {
    expect('createCodaraRuntimePlan' in codara).toBe(false);
    expect('resolveCodaraRuntime' in codara).toBe(false);
  });

  it('should keep thin Codara tasks wrappers out of the public codara barrel', () => {
    expect('createCodaraTaskTool' in codara).toBe(false);
    expect('createCodaraTaskMiddleware' in codara).toBe(false);
    expect('createCodaraSubagentTool' in codara).toBe(false);
    expect('createCodaraSubagentMiddleware' in codara).toBe(false);
  });

  it('should keep codara assembly helpers and command runner out of the public codara barrel', () => {
    expect('createCodaraAgent' in codara).toBe(false);
    expect('createCodaraTools' in codara).toBe(false);
    expect('createCodaraMiddlewares' in codara).toBe(false);
    expect('createCodaraCommandRunner' in codara).toBe(false);
    expect('resolveCodaraSkills' in codara).toBe(false);
    expect('CodaraCommandResult' in codara).toBe(false);
    expect('CodaraCommandSpec' in codara).toBe(false);
  });
});
