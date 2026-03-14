// src/core/permission/bash/analyzer.ts

import { BashAnalysisResult, RiskLevel, FileOperation, CommandComplexity } from '../types';

export class BashCommandAnalyzer {
  private readonly DANGEROUS_COMMANDS = ['rm', 'dd', 'mkfs', 'format', ':(){:|:&};:'];
  private readonly WRITE_COMMANDS = ['mv', 'cp', 'touch', 'mkdir', 'chmod', 'chown'];

  analyze(command: string): BashAnalysisResult {
    const tokens = this.tokenize(command);
    const complexity = this.detectComplexity(command);
    const normalized = this.normalize(command);
    const operations = this.extractFileOperations(tokens);
    const risk = this.assessRisk(tokens, complexity);

    return {
      command,
      normalized,
      risk,
      operations,
      complexity
    };
  }

  private tokenize(command: string): string[] {
    return command.split(/\s+/).filter(t => t.length > 0);
  }

  private detectComplexity(command: string): CommandComplexity {
    return {
      hasRedirect: /[<>]/.test(command),
      hasPipe: /\|/.test(command),
      hasSubshell: /[`$()]/.test(command)
    };
  }

  private normalize(command: string): string {
    return command
      .replace(/\s+/g, ' ')
      .replace(/["']/g, '')
      .trim();
  }

  private extractFileOperations(tokens: string[]): FileOperation[] {
    const operations: FileOperation[] = [];
    // 简化实现：检测常见文件操作
    if (tokens.includes('cat') || tokens.includes('less')) {
      operations.push({ type: 'read', path: tokens[1] || '', tool: 'Read' });
    }
    return operations;
  }

  private assessRisk(tokens: string[], complexity: CommandComplexity): RiskLevel {
    const commandName = tokens[0] || '';

    // 危险命令
    if (this.DANGEROUS_COMMANDS.includes(commandName)) {
      return 'critical';
    }

    // 带 -rf 的 rm
    if (commandName === 'rm' && tokens.includes('-rf')) {
      return 'critical';
    }

    // 写操作
    if (this.WRITE_COMMANDS.includes(commandName)) {
      return 'medium';
    }

    // 复杂命令
    if (complexity.hasSubshell || complexity.hasPipe) {
      return 'medium';
    }

    return 'low';
  }
}
