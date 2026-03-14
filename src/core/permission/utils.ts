// src/core/permission/utils.ts

import { randomBytes } from 'crypto';
import { ParsedToolExpression } from './types';

export function parseToolExpression(expression: string): ParsedToolExpression {
  const match = expression.match(/^(\w+)\((.+)\)$/);
  if (!match) {
    throw new Error(`Invalid tool expression: ${expression}`);
  }
  return {
    tool: match[1],
    specifier: match[2]
  };
}

export function formatExpression(parsed: ParsedToolExpression): string {
  return `${parsed.tool}(${parsed.specifier})`;
}

export function generateId(): string {
  return randomBytes(16).toString('hex');
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function toDirectoryScopeExpression(tool: string, filePath: string): string {
  const normalized = normalizePath(filePath);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) {
    return `${tool}(*)`;
  }
  const directory = normalized.substring(0, lastSlash + 1);
  return `${tool}(${directory}*)`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}
