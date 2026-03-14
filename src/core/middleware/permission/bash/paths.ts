import {tokenizeShellCommand} from './parser';
import {stripLeadingShellEnvironment, unwrapShellLauncherCommand} from './normalize';

export function extractBashWritePathOperands(command: string): string[] {
  const tokenized = tokenizeShellCommand(command);
  if (tokenized.tokens.length === 0 || tokenized.complex) {
    return [];
  }

  const withoutEnv = stripLeadingShellEnvironment(tokenized.tokens);
  if (withoutEnv.length === 0) {
    return [];
  }

  const unwrapped = unwrapShellLauncherCommand(withoutEnv);
  if (unwrapped) {
    return extractBashWritePathOperands(unwrapped);
  }

  return collectShellWriteRedirectionOperands(withoutEnv);
}

function collectShellWriteRedirectionOperands(tokens: string[]): string[] {
  const operands: string[] = [];
  let skipNext = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (isStandaloneShellWriteRedirection(token)) {
      const next = tokens[index + 1]?.trim();
      if (next && !isShellDescriptorTarget(next)) {
        operands.push(next);
      }
      skipNext = true;
      continue;
    }

    const inlineTarget = readInlineShellWriteRedirectionTarget(token);
    if (inlineTarget) {
      operands.push(inlineTarget);
    }
  }

  return operands;
}

function isStandaloneShellWriteRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?>>?$|^&>>?$/.test(token));
}

function readInlineShellWriteRedirectionTarget(token: string | undefined): string | undefined {
  if (!token) {
    return undefined;
  }

  const match = token.match(/^(?:\d+)?(>>?|>|&>>?|&>)(.+)$/);
  if (!match) {
    return undefined;
  }

  const target = match[2]?.trim();
  if (!target || isShellDescriptorTarget(target)) {
    return undefined;
  }

  return target;
}

function isShellDescriptorTarget(token: string | undefined): boolean {
  return Boolean(token && /^&\d+$/.test(token));
}
