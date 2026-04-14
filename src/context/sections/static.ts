// Static sections are assembled once at session start and cached for prompt caching efficiency.
// They are separated from dynamic sections by SYSTEM_PROMPT_DYNAMIC_BOUNDARY.

export interface StaticPromptSections {
  baseInstructions: string;
  toolDefinitions: string;
  styleGuidelines: string;
}

export function assembleStaticPrompt(sections: Partial<StaticPromptSections>): string {
  const parts: string[] = [];
  if (sections.baseInstructions?.trim()) parts.push(sections.baseInstructions.trim());
  if (sections.toolDefinitions?.trim()) parts.push(sections.toolDefinitions.trim());
  if (sections.styleGuidelines?.trim()) parts.push(sections.styleGuidelines.trim());
  return parts.join('\n\n');
}
