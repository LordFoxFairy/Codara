import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {HumanMessage, SystemMessage} from '@langchain/core/messages';

export interface PermissionBashClassification {
  reason?: string;
  pathScopeExpression?: string;
  toolScopeExpression?: string;
}

export type PermissionBashClassifier = (input: {
  command: string;
  cwd?: string;
  projectRoot?: string;
}) => Promise<PermissionBashClassification | undefined>;

export function createModelPermissionBashClassifier(modelInput: {
  model: BaseChatModel | Promise<BaseChatModel> | (() => Promise<BaseChatModel>);
}): PermissionBashClassifier {
  return async (input) => {
    const model = await resolveClassifierModel(modelInput.model);
    const response = await model.invoke([
      new SystemMessage([
        'You analyze bash commands for a permission review system.',
        'Return JSON only.',
        'Do not decide whether the command should be allowed.',
        'Only infer a safer permission suggestion when it is obvious.',
        'Prefer path-scoped rules for file or directory writes.',
        'Prefer tool-scoped bash rules only when the command family is clear.',
        'Use null for unknown fields.',
      ].join(' ')),
      new HumanMessage([
        'Analyze this bash command for permission review.',
        'Return JSON with exactly these keys:',
        '{"reason": string|null, "pathScopeExpression": string|null, "toolScopeExpression": string|null}',
        '',
        `cwd: ${input.cwd ?? ''}`,
        `projectRoot: ${input.projectRoot ?? ''}`,
        `command: ${input.command}`,
      ].join('\n')),
    ]);

    return sanitizeClassification(parseClassifierPayload(response.text));
  };
}

function parseClassifierPayload(text: string): PermissionBashClassification | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    return {
      reason: readString(parsed.reason),
      pathScopeExpression: readString(parsed.pathScopeExpression),
      toolScopeExpression: readString(parsed.toolScopeExpression),
    };
  } catch {
    return undefined;
  }
}

function sanitizeClassification(
  value: PermissionBashClassification | undefined,
): PermissionBashClassification | undefined {
  if (!value) {
    return undefined;
  }

  const pathScopeExpression = normalizePathScopeExpression(value.pathScopeExpression);
  const toolScopeExpression = normalizeToolScopeExpression(value.toolScopeExpression);
  const reason = readString(value.reason);

  if (!pathScopeExpression && !toolScopeExpression && !reason) {
    return undefined;
  }

  return {
    ...(reason ? {reason} : {}),
    ...(pathScopeExpression ? {pathScopeExpression} : {}),
    ...(toolScopeExpression ? {toolScopeExpression} : {}),
  };
}

async function resolveClassifierModel(
  input: BaseChatModel | Promise<BaseChatModel> | (() => Promise<BaseChatModel>),
): Promise<BaseChatModel> {
  if (typeof input === 'function') {
    return input();
  }
  return await input;
}

function normalizePathScopeExpression(value: string | undefined): string | undefined {
  const expression = readString(value);
  if (!expression) {
    return undefined;
  }

  const match = expression.match(/^(Read|Write|Edit)\((.+)\)$/);
  if (!match) {
    return undefined;
  }

  const target = match[2].trim();
  if (!target || target === '*' || target.includes('..')) {
    return undefined;
  }

  return `${match[1]}(${target})`;
}

function normalizeToolScopeExpression(value: string | undefined): string | undefined {
  const expression = readString(value);
  if (!expression) {
    return undefined;
  }

  const match = expression.match(/^Bash\((.+)\)$/);
  if (!match) {
    return undefined;
  }

  const target = match[1].trim();
  if (!target) {
    return undefined;
  }

  return `Bash(${target})`;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
