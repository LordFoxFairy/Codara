// src/core/permission/policy/engine.ts

import { parseToolExpression, formatExpression } from '../utils';
import { PermissionPolicyLoader } from './loader';
import { PermissionRuleMatcher } from './matcher';
import type {
  PermissionEvaluationResult,
  PermissionPolicyOptions,
  MergedPermissionPolicy,
  PermissionRule
} from '../types';

export class PermissionPolicyEngine {
  private loader = new PermissionPolicyLoader();
  private matcher = new PermissionRuleMatcher();
  private ruleCache = new Map<string, PermissionEvaluationResult>();
  private policyCache: MergedPermissionPolicy | null = null;
  private policyCacheTime = 0;
  private readonly CACHE_TTL = 5000; // 5 秒

  async evaluate(
    expression: string,
    options: PermissionPolicyOptions
  ): Promise<PermissionEvaluationResult> {
    // 1. 检查缓存
    const cached = this.ruleCache.get(expression);
    if (cached && Date.now() - (cached as any).timestamp < this.CACHE_TTL) {
      return cached;
    }

    // 2. 加载策略
    const policy = await this.loadPolicyWithCache(options);

    // 3. 解析表达式
    const call = parseToolExpression(expression);

    // 4. 执行匹配
    const result = this.matchRules(call, policy);

    // 5. 缓存结果
    const resultWithTimestamp = { ...result, timestamp: Date.now() } as any;
    this.ruleCache.set(expression, resultWithTimestamp);

    return result;
  }

  private async loadPolicyWithCache(
    options: PermissionPolicyOptions
  ): Promise<MergedPermissionPolicy> {
    const now = Date.now();

    if (this.policyCache && now - this.policyCacheTime < this.CACHE_TTL) {
      return this.policyCache;
    }

    const policies = await this.loader.loadMultiplePolicies(options);
    this.policyCache = this.mergePolicies(policies);
    this.policyCacheTime = now;

    return this.policyCache;
  }

  private mergePolicies(policies: any[]): MergedPermissionPolicy {
    const merged: MergedPermissionPolicy = {
      deny: [],
      ask: [],
      allow: [],
      defaultDecision: 'ask',
      sources: [],
      summary: { deny: 0, ask: 0, allow: 0 }
    };

    // 合并所有策略的规则
    for (const policy of policies) {
      merged.deny.push(...(policy.rules.deny || []).map((r: string) => ({
        expression: r,
        bucket: 'deny' as const,
        source: { scope: 'codara_local' as const, path: '', exists: true, format: 'json' }
      })));

      merged.ask.push(...(policy.rules.ask || []).map((r: string) => ({
        expression: r,
        bucket: 'ask' as const,
        source: { scope: 'codara_local' as const, path: '', exists: true, format: 'json' }
      })));

      merged.allow.push(...(policy.rules.allow || []).map((r: string) => ({
        expression: r,
        bucket: 'allow' as const,
        source: { scope: 'codara_local' as const, path: '', exists: true, format: 'json' }
      })));

      // 使用第一个策略的默认决策
      if (!merged.defaultDecision && policy.defaultDecision) {
        merged.defaultDecision = policy.defaultDecision;
      }
    }

    merged.summary = {
      deny: merged.deny.length,
      ask: merged.ask.length,
      allow: merged.allow.length
    };

    return merged;
  }

  private matchRules(
    call: any,
    policy: MergedPermissionPolicy
  ): PermissionEvaluationResult {
    // 优先级：deny > ask > allow

    // 1. 检查 deny 规则
    const denyMatch = this.findMatch(call, policy.deny);
    if (denyMatch) {
      return {
        input: formatExpression(call),
        decision: 'deny',
        matched: denyMatch,
        defaultDecision: policy.defaultDecision,
        sources: policy.sources,
        policySummary: policy.summary
      };
    }

    // 2. 检查 ask 规则
    const askMatch = this.findMatch(call, policy.ask);
    if (askMatch) {
      return {
        input: formatExpression(call),
        decision: 'ask',
        matched: askMatch,
        defaultDecision: policy.defaultDecision,
        sources: policy.sources,
        policySummary: policy.summary
      };
    }

    // 3. 检查 allow 规则
    const allowMatch = this.findMatch(call, policy.allow);
    if (allowMatch) {
      return {
        input: formatExpression(call),
        decision: 'allow',
        matched: allowMatch,
        defaultDecision: policy.defaultDecision,
        sources: policy.sources,
        policySummary: policy.summary
      };
    }

    // 4. 使用默认决策
    return {
      input: formatExpression(call),
      decision: policy.defaultDecision,
      matched: null,
      defaultDecision: policy.defaultDecision,
      sources: policy.sources,
      policySummary: policy.summary
    };
  }

  private findMatch(call: any, rules: PermissionRule[]): any {
    for (const rule of rules) {
      if (this.matcher.matches(call, rule.expression)) {
        return {
          bucket: rule.bucket,
          rule: rule.expression,
          scope: rule.source.scope
        };
      }
    }
    return null;
  }

  clearCache(): void {
    this.ruleCache.clear();
    this.policyCache = null;
  }
}
