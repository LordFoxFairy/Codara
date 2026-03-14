// src/core/permission/policy/matcher.ts

import { globToRegExp, normalizePath } from '../utils';
import type { ParsedToolExpression } from '../types';

export class PermissionRuleMatcher {
  matches(call: ParsedToolExpression, ruleExpression: string): boolean {
    const ruleMatch = ruleExpression.match(/^(\w+)\((.+)\)$/);
    if (!ruleMatch) return false;

    const [, ruleTool, ruleSpecifier] = ruleMatch;

    // 工具名必须匹配
    if (call.tool !== ruleTool) return false;

    // Bash 特殊处理
    if (call.tool === 'Bash') {
      return this.bashSpecifierMatches(call.specifier, ruleSpecifier);
    }

    // 路径相关工具
    if (['Read', 'Write', 'Edit'].includes(call.tool)) {
      return this.pathSpecifierMatches(call.specifier, ruleSpecifier);
    }

    // 其他工具：精确匹配或通配符
    return ruleSpecifier === '*' || call.specifier === ruleSpecifier;
  }

  private pathSpecifierMatches(callPath: string, rulePath: string): boolean {
    const callPattern = normalizePath(callPath);
    const rulePattern = normalizePath(rulePath);

    // 通配符匹配
    if (rulePattern === '*') return true;

    if (rulePattern.includes('*')) {
      return globToRegExp(rulePattern).test(callPattern);
    }

    // 目录匹配
    if (rulePattern.endsWith('/')) {
      return callPattern === rulePattern || callPattern.startsWith(rulePattern);
    }

    // 精确匹配
    return callPattern === rulePattern;
  }

  private bashSpecifierMatches(callCommand: string, ruleCommand: string): boolean {
    // 通配符匹配
    if (ruleCommand === '*') return true;

    // 提取命令名和子命令
    const callTokens = callCommand.split(/\s+/);
    const ruleTokens = ruleCommand.split(/\s+/);

    // 命令名必须匹配
    if (callTokens[0] !== ruleTokens[0]) return false;

    // 如果规则只有命令名 + *，匹配所有该命令
    if (ruleTokens.length === 2 && ruleTokens[1] === '*') {
      return true;
    }

    // 子命令匹配
    if (ruleTokens.length >= 2 && callTokens.length >= 2) {
      if (callTokens[1] !== ruleTokens[1]) return false;

      // 如果规则有子命令 + *，匹配所有该子命令
      if (ruleTokens.length === 3 && ruleTokens[2] === '*') {
        return true;
      }
    }

    // 精确匹配
    return callCommand === ruleCommand;
  }
}
