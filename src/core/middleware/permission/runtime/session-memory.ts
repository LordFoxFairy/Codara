// src/core/permission/runtime/session-memory.ts

import { globToRegExp, normalizePath } from '../utils';

export class SessionMemoryManager {
  private allowedExpressions = new Set<string>();

  add(expression: string): void {
    this.allowedExpressions.add(expression);
  }

  isAllowed(expression: string): boolean {
    // 精确匹配
    if (this.allowedExpressions.has(expression)) {
      return true;
    }

    // 通配符匹配
    for (const allowed of this.allowedExpressions) {
      if (this.matches(expression, allowed)) {
        return true;
      }
    }

    return false;
  }

  private matches(expression: string, pattern: string): boolean {
    const exprMatch = expression.match(/^(\w+)\((.+)\)$/);
    const patternMatch = pattern.match(/^(\w+)\((.+)\)$/);

    if (!exprMatch || !patternMatch) return false;

    const [, exprTool, exprSpec] = exprMatch;
    const [, patternTool, patternSpec] = patternMatch;

    // 工具名必须匹配
    if (exprTool !== patternTool) return false;

    // 通配符匹配
    if (patternSpec === '*') return true;

    // 目录通配符匹配
    if (patternSpec.includes('*')) {
      const regex = globToRegExp(normalizePath(patternSpec));
      return regex.test(normalizePath(exprSpec));
    }

    return false;
  }

  clear(): void {
    this.allowedExpressions.clear();
  }

  getAll(): string[] {
    return Array.from(this.allowedExpressions);
  }
}
