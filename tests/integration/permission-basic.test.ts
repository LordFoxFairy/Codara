// tests/integration/permission-basic.test.ts

import { describe, it, expect } from 'vitest';
import { PermissionRuntime } from '@/core/middleware/permission/runtime/runtime';
import { PermissionPolicyEngine } from '@/core/middleware/permission/policy/engine';

describe('Permission System Integration', () => {
  it('should evaluate allow decision', async () => {
    const engine = new PermissionPolicyEngine();

    const result = await engine.evaluate('Read(src/index.ts)', {
      policies: [{
        rules: { allow: ['Read(*)'], ask: [], deny: [] },
        defaultDecision: 'ask'
      }]
    });

    expect(result.decision).toBe('allow');
    expect(result.matched).toBeDefined();
  });

  it('should use session memory', () => {
    const runtime = new PermissionRuntime();

    runtime.addSessionMemory('Edit(src/components/*)');

    const allowed = runtime.isSessionAllowed('Edit(src/components/Header.tsx)');
    expect(allowed).toBe(true);
  });

  it('should respect deny rules', async () => {
    const engine = new PermissionPolicyEngine();

    const result = await engine.evaluate('Bash(rm -rf /)', {
      policies: [{
        rules: {
          deny: ['Bash(rm -rf /)'],
          ask: [],
          allow: ['Bash(*)']
        },
        defaultDecision: 'ask'
      }]
    });

    expect(result.decision).toBe('deny');
  });
});
