import type {SkillMetadata} from '@infra/context/skills/contracts';

export const SKILLS_SYSTEM_PROMPT = `
## Skills System

Execute a skill within the main conversation.

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/debug"), they are referring to a skill. Use the Skill tool to invoke it.

{skills_locations}

**Available Skills:**

{skills_list}

Important:
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling the Skill tool
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded — follow the instructions directly instead of calling the Skill tool again
- Do not invoke a skill that is already running
`;

export function formatSkillAnnotations(skill: SkillMetadata): string {
  const parts: string[] = [];
  if (skill.license) {
    parts.push(`License: ${skill.license}`);
  }
  if (skill.compatibility) {
    parts.push(`Compatibility: ${skill.compatibility}`);
  }
  return parts.join(', ');
}

export function formatSkillsLocations(sources: string[]): string {
  if (sources.length === 0) {
    return '**Skills Sources:** None configured';
  }

  const lines: string[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    const sourcePath = sources[i];
    const name =
      sourcePath
        .replace(/[/\\]$/, '')
        .split(/[/\\]/)
        .filter(Boolean)
        .pop()
        ?.replace(/^./, (char) => char.toUpperCase()) ?? 'Skills';
    const suffix = i === sources.length - 1 ? ' (higher priority)' : '';
    lines.push(`**${name} Skills**: \`${sourcePath}\`${suffix}`);
  }
  return lines.join('\n');
}

export function formatSkillsList(skills: SkillMetadata[], sources: string[]): string {
  if (skills.length === 0) {
    return sources.length > 0
      ? `(No skills available yet. Add SKILL.md files to ${sources.map((s) => `\`${s}\``).join(' or ')})`
      : '(No skills available yet.)';
  }

  return skills.map((skill) => {
    const cmd = skill.command?.name ? ` (/${skill.command.name})` : '';
    const loc = skill.path ? `\n  Path: ${skill.path}` : '';
    return `- ${skill.name}${cmd}: ${skill.description}${loc}`;
  }).join('\n');
}
