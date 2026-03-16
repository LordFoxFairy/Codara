const TOOL_REFERENCE_ALIASES: Record<string, string> = {
  bash: 'bash',
  glob: 'glob',
  grep: 'grep',
  read: 'read_file',
  read_file: 'read_file',
  write: 'write_file',
  write_file: 'write_file',
  edit: 'edit_file',
  edit_file: 'edit_file',
  fetch: 'fetch_url',
  fetch_url: 'fetch_url',
  webfetch: 'fetch_url',
  search: 'web_search',
  web_search: 'web_search',
  websearch: 'web_search',
};

export function normalizeToolReferenceName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return TOOL_REFERENCE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
