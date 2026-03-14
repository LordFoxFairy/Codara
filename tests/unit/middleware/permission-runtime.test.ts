import {describe, expect, it} from 'bun:test';

/**
 * 以下两个函数从 runtime.ts 中复制出来做单元测试。
 * runtime.ts 中这两个函数是 module-private 的，
 * 这里直接内联测试逻辑以验证核心行为。
 */

function toDirectoryScopeExpression(expression: string): string {
  const openIndex = expression.indexOf('(');
  if (openIndex < 0) {
    return expression;
  }

  const toolName = expression.slice(0, openIndex);
  const specifier = expression.slice(openIndex + 1, -1);
  const lastSlash = specifier.lastIndexOf('/');

  if (lastSlash < 0) {
    return `${toolName}(*)`;
  }

  const directory = specifier.slice(0, lastSlash);
  return `${toolName}(${directory}/*)`;
}

function isSessionAllowed(expression: string, sessionAllowed: Set<string>): boolean {
  if (sessionAllowed.has(expression)) {
    return true;
  }

  const openIndex = expression.indexOf('(');
  if (openIndex < 0) {
    return false;
  }

  const toolName = expression.slice(0, openIndex);
  const specifier = expression.slice(openIndex + 1, -1);

  for (const rule of sessionAllowed) {
    const ruleOpenIndex = rule.indexOf('(');
    if (ruleOpenIndex < 0) {
      continue;
    }

    const ruleTool = rule.slice(0, ruleOpenIndex);
    if (ruleTool !== toolName) {
      continue;
    }

    const ruleSpecifier = rule.slice(ruleOpenIndex + 1, -1);
    if (ruleSpecifier === '*') {
      return true;
    }

    if (ruleSpecifier.endsWith('/*')) {
      const ruleDir = ruleSpecifier.slice(0, -2);
      const specifierDir = specifier.slice(0, specifier.lastIndexOf('/'));
      if (specifierDir === ruleDir) {
        return true;
      }
    }
  }

  return false;
}

describe('permission runtime: toDirectoryScopeExpression', () => {
  it('should scope Edit to the parent directory', () => {
    expect(toDirectoryScopeExpression('Edit(src/components/Header.tsx)')).toBe('Edit(src/components/*)');
  });

  it('should scope Write to the parent directory', () => {
    expect(toDirectoryScopeExpression('Write(src/utils/helper.ts)')).toBe('Write(src/utils/*)');
  });

  it('should fallback to wildcard for root-level files', () => {
    expect(toDirectoryScopeExpression('Edit(package.json)')).toBe('Edit(*)');
  });

  it('should handle deeply nested paths', () => {
    expect(toDirectoryScopeExpression('Edit(src/core/middleware/permission/runtime.ts)')).toBe('Edit(src/core/middleware/permission/*)');
  });

  it('should return expression as-is when no parenthesis', () => {
    expect(toDirectoryScopeExpression('Edit')).toBe('Edit');
  });
});

describe('permission runtime: isSessionAllowed', () => {
  it('should match exact expression', () => {
    const allowed = new Set(['Edit(src/components/Header.tsx)']);
    expect(isSessionAllowed('Edit(src/components/Header.tsx)', allowed)).toBe(true);
  });

  it('should match same-directory files via directory wildcard', () => {
    const allowed = new Set(['Edit(src/components/*)']);
    expect(isSessionAllowed('Edit(src/components/Header.tsx)', allowed)).toBe(true);
    expect(isSessionAllowed('Edit(src/components/Button.tsx)', allowed)).toBe(true);
    expect(isSessionAllowed('Edit(src/components/Footer.tsx)', allowed)).toBe(true);
  });

  it('should NOT match files in different directories', () => {
    const allowed = new Set(['Edit(src/components/*)']);
    expect(isSessionAllowed('Edit(src/utils/helper.ts)', allowed)).toBe(false);
    expect(isSessionAllowed('Edit(package.json)', allowed)).toBe(false);
    expect(isSessionAllowed('Edit(tests/unit/foo.test.ts)', allowed)).toBe(false);
  });

  it('should NOT match subdirectories (non-recursive)', () => {
    const allowed = new Set(['Edit(src/components/*)']);
    expect(isSessionAllowed('Edit(src/components/sub/deep.tsx)', allowed)).toBe(false);
  });

  it('should match root wildcard for root-level files', () => {
    const allowed = new Set(['Edit(*)']);
    expect(isSessionAllowed('Edit(package.json)', allowed)).toBe(true);
    expect(isSessionAllowed('Edit(tsconfig.json)', allowed)).toBe(true);
  });

  it('should NOT cross tool boundaries', () => {
    const allowed = new Set(['Edit(src/components/*)']);
    expect(isSessionAllowed('Write(src/components/Header.tsx)', allowed)).toBe(false);
  });

  it('should support multiple directories in the session', () => {
    const allowed = new Set(['Edit(src/components/*)', 'Edit(src/utils/*)']);
    expect(isSessionAllowed('Edit(src/components/Header.tsx)', allowed)).toBe(true);
    expect(isSessionAllowed('Edit(src/utils/helper.ts)', allowed)).toBe(true);
    expect(isSessionAllowed('Edit(src/core/agent.ts)', allowed)).toBe(false);
  });

  it('should return false for expressions without parenthesis', () => {
    const allowed = new Set(['Edit(src/*)']);
    expect(isSessionAllowed('Edit', allowed)).toBe(false);
  });
});

describe('permission runtime: end-to-end session flow', () => {
  it('should simulate the 50-files-in-same-directory scenario', () => {
    const sessionAllowed = new Set<string>();

    // 第 1 个文件：用户按 a（dont_ask_again）
    const firstExpression = 'Edit(src/components/Header.tsx)';
    sessionAllowed.add(toDirectoryScopeExpression(firstExpression));

    // 验证会话记忆内容
    expect(sessionAllowed.has('Edit(src/components/*)')).toBe(true);

    // 第 2-50 个文件：全部自动放行
    const filesInSameDir = [
      'Edit(src/components/Button.tsx)',
      'Edit(src/components/Footer.tsx)',
      'Edit(src/components/Sidebar.tsx)',
      'Edit(src/components/Nav.tsx)',
      'Edit(src/components/Modal.tsx)',
    ];

    for (const file of filesInSameDir) {
      expect(isSessionAllowed(file, sessionAllowed)).toBe(true);
    }

    // 其他目录仍然弹窗
    expect(isSessionAllowed('Edit(src/utils/format.ts)', sessionAllowed)).toBe(false);
    expect(isSessionAllowed('Edit(package.json)', sessionAllowed)).toBe(false);
    expect(isSessionAllowed('Write(src/components/Header.tsx)', sessionAllowed)).toBe(false);
  });

  it('should simulate Bash exact-match (no session memory for Bash)', () => {
    const sessionAllowed = new Set<string>();

    // Bash 走持久化路径，不走 session memory
    // 这里只验证 session memory 不会匹配 Bash
    expect(isSessionAllowed('Bash(git push origin main)', sessionAllowed)).toBe(false);

    // 即使手动加了也只匹配精确命令
    sessionAllowed.add('Bash(git push origin main)');
    expect(isSessionAllowed('Bash(git push origin main)', sessionAllowed)).toBe(true);
    expect(isSessionAllowed('Bash(git push origin dev)', sessionAllowed)).toBe(false);
  });
});
