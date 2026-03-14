// src/core/permission/policy/loader.ts

import { readFile } from 'fs/promises';
import { PermissionPolicyOptions } from '../types';

export class PermissionPolicyLoader {
  async loadMultiplePolicies(options: PermissionPolicyOptions): Promise<any[]> {
    const policies: any[] = [];

    // 如果直接提供了 policies，使用它们
    if (options.policies && options.policies.length > 0) {
      return options.policies;
    }

    // 否则从文件加载
    const files = options.policyFiles || [];
    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const policy = JSON.parse(content);
        if (policy.permissions) {
          policies.push(policy.permissions);
        }
      } catch (error) {
        // 忽略文件读取错误，继续加载其他文件
        console.warn(`Failed to load policy from ${file}:`, error);
      }
    }

    // 如果没有加载到任何策略，返回默认策略
    if (policies.length === 0) {
      policies.push({
        rules: { allow: [], ask: [], deny: [] },
        defaultDecision: 'ask'
      });
    }

    return policies;
  }
}
