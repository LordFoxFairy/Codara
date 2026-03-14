import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

describe('case: generic HIL form UI', () => {
  it('should render a structured form-style HIL request through the real CLI path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-hil-form-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Start planning',
      scenario: 'hil-form',
      env: {
        CODARA_CLI_HIL_AUTO_ACTIONS: JSON.stringify([{
          action: 'submit',
          answers: {
            domain: 'SaaS product',
            scope: 'MVP',
          },
        }]),
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('HIL_FORM_DONE:domain,scope');
    expect(result.output).not.toContain('{"action":"submit","answers":{}}');
  });
});
