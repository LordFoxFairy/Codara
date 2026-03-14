import {HumanMessage, SystemMessage} from '@langchain/core/messages';

export interface PermissionBashAnalysis {
  reason?: string;
  pathScopeExpression?: string;
  toolScopeExpression?: string;
}

export interface PermissionAnalysisModel {
  invoke(messages: [SystemMessage, HumanMessage]): Promise<{text?: string; content?: unknown}>;
}

export type PermissionBashAnalysisFn = (input: {
  command: string;
  cwd?: string;
  projectRoot?: string;
}) => Promise<PermissionBashAnalysis | undefined>;

export function createModelPermissionBashAnalysis(modelInput: {
  model: PermissionAnalysisModel | Promise<PermissionAnalysisModel> | (() => Promise<PermissionAnalysisModel>);
}): PermissionBashAnalysisFn {
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

    return sanitizeClassification(parseClassifierPayload(readAnalysisResponseText(response)));
  };
}

function parseClassifierPayload(text: string): PermissionBashAnalysis | undefined {
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
  value: PermissionBashAnalysis | undefined,
): PermissionBashAnalysis | undefined {
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
  input: PermissionAnalysisModel | Promise<PermissionAnalysisModel> | (() => Promise<PermissionAnalysisModel>),
): Promise<PermissionAnalysisModel> {
  if (typeof input === 'function') {
    return input();
  }
  return await input;
}

function readAnalysisResponseText(response: {text?: string; content?: unknown}): string {
  if (typeof response.text === 'string' && response.text.trim().length > 0) {
    return response.text;
  }

  if (typeof response.content === 'string') {
    return response.content;
  }

  return '';
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
