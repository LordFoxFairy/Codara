// src/core/permission/runtime/runtime.ts

import { promises as fs } from 'fs';
import { join } from 'path';
import { PermissionPolicyEngine } from '../policy/engine';
import { SessionMemoryManager } from './session-memory';
import { BashCommandAnalyzer } from '../bash/analyzer';
import type { ToolCall, PermissionEvaluationResult, PermissionPolicyOptions } from '../types';

export class PermissionRuntime {
  private policyEngine = new PermissionPolicyEngine();
  private sessionMemory = new SessionMemoryManager();
  private bashAnalyzer = new BashCommandAnalyzer();

  async resolveDecision(
    toolCall: ToolCall,
    options: PermissionPolicyOptions
  ): Promise<PermissionEvaluationResult> {
    const expression = `${toolCall.tool}(${toolCall.input})`;

    // 1. 检查会话记忆
    if (this.sessionMemory.isAllowed(expression)) {
      return {
        input: expression,
        decision: 'allow',
        matched: { bucket: 'allow', rule: 'session-memory', scope: 'session' },
        defaultDecision: 'ask',
        sources: [],
        policySummary: { deny: 0, ask: 0, allow: 0 }
      };
    }

    // 2. 对于 Bash 命令，进行风险分析
    if (toolCall.tool === 'Bash') {
      const analysis = this.bashAnalyzer.analyze(toolCall.input);

      // 高风险或严重风险命令自动拒绝
      if (analysis.risk === 'critical') {
        return {
          input: expression,
          decision: 'deny',
          matched: { bucket: 'deny', rule: 'bash-risk-critical', scope: 'runtime' },
          defaultDecision: 'ask',
          sources: [],
          policySummary: { deny: 1, ask: 0, allow: 0 },
          metadata: { bashAnalysis: analysis }
        };
      }
    }

    // 3. 评估策略
    const evaluation = await this.policyEngine.evaluate(expression, options);

    // 4. 对于 Bash 命令，附加分析结果
    if (toolCall.tool === 'Bash') {
      const analysis = this.bashAnalyzer.analyze(toolCall.input);
      evaluation.metadata = { ...evaluation.metadata, bashAnalysis: analysis };
    }

    return evaluation;
  }

  addSessionMemory(expression: string): void {
    this.sessionMemory.add(expression);
  }

  isSessionAllowed(expression: string): boolean {
    return this.sessionMemory.isAllowed(expression);
  }

  async persistBashRule(expression: string): Promise<void> {
    const settingsPath = join(process.cwd(), '.codara', 'settings.local.json');

    try {
      let settings: any = {};

      try {
        const content = await fs.readFile(settingsPath, 'utf-8');
        settings = JSON.parse(content);
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
      }

      // 初始化结构
      if (!settings.permissions) {
        settings.permissions = { rules: { allow: [], ask: [], deny: [] } };
      }
      if (!settings.permissions.rules) {
        settings.permissions.rules = { allow: [], ask: [], deny: [] };
      }
      if (!settings.permissions.rules.allow) {
        settings.permissions.rules.allow = [];
      }

      // 添加规则（避免重复）
      if (!settings.permissions.rules.allow.includes(expression)) {
        settings.permissions.rules.allow.push(expression);
      }

      // 写回文件
      await fs.mkdir(join(process.cwd(), '.codara'), { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error('Failed to persist Bash rule:', error);
      throw error;
    }
  }

  clearSessionMemory(): void {
    this.sessionMemory.clear();
  }

  getSessionMemory(): string[] {
    return this.sessionMemory.getAll();
  }
}
