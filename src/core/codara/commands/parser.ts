import type {ParsedCodaraCommand} from '@core/codara/commands/types';

export function parseCodaraCommand(input: string): ParsedCodaraCommand | undefined {
  const raw = input.trim();
  if (!raw.startsWith('/')) {
    return undefined;
  }

  const body = raw.slice(1).trim();
  if (!body) {
    return undefined;
  }

  const parts = body.split(/\s+/).filter(Boolean);
  const [name, ...args] = parts;
  if (!name) {
    return undefined;
  }

  return {
    raw,
    name: name.toLowerCase(),
    args,
    argsText: args.join(' '),
  };
}
