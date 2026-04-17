/**
 * Plugin-command → skill translation.
 *
 * Converts plugin `commands/*.md` files into Codara skill directories so
 * imported command definitions become first-class skills without format loss.
 *
 * @module
 */

import {existsSync} from 'node:fs';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parseMarkdownFrontmatterDocument} from '@skills/catalog/loading';

export async function importPluginCommandsAsSkills(input: {
  pluginName: string;
  commandsRoot: string;
  destinationRoot: string;
}): Promise<{installedSkills: string[]; skippedSkills: string[]}> {
  if (!existsSync(input.commandsRoot)) {
    return {installedSkills: [], skippedSkills: []};
  }

  const entries = await readdir(input.commandsRoot, {withFileTypes: true});
  const installedSkills: string[] = [];
  const skippedSkills: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const commandFile = path.join(input.commandsRoot, entry.name);
    const command = await translatePluginCommand(commandFile, input.pluginName);
    if (!command) continue;

    const skillDir = path.join(input.destinationRoot, command.skillName);
    if (existsSync(skillDir)) {
      skippedSkills.push(command.skillName);
      continue;
    }

    await mkdir(skillDir, {recursive: true});
    await writeFile(path.join(skillDir, 'SKILL.md'), command.skillContent, 'utf8');
    installedSkills.push(command.skillName);
  }

  return {installedSkills, skippedSkills};
}

async function translatePluginCommand(
  commandFile: string,
  pluginName: string,
): Promise<{skillName: string; skillContent: string} | undefined> {
  const raw = await readFile(commandFile, 'utf8');
  const parsed = parseMarkdownFrontmatterDocument(raw, commandFile);
  const body = parsed?.body?.trim() ?? raw.trim();
  const frontmatter = parsed?.frontmatter ?? {};
  const commandName = normalizeCommandName(path.basename(commandFile, '.md'));
  if (!commandName) return undefined;

  const skillName = normalizeSkillName(`${pluginName}-${commandName}`);
  const description = normalizeScalar(frontmatter.description) ?? `Imported plugin command ${commandName}.`;
  const allowedTools = normalizeAllowedTools(frontmatter['allowed-tools']);
  const lines = [
    '---',
    `name: ${skillName}`,
    `description: ${escapeYamlScalar(description)}`,
    `command-name: ${commandName}`,
    `command-description: ${escapeYamlScalar(description)}`,
    `command-usage: /${commandName}`,
    ...(allowedTools.length > 0 ? [`allowed-tools: ${allowedTools.join(', ')}`] : []),
    'metadata:',
    `  imported-from-plugin: ${pluginName}`,
    `  source-command: ${path.basename(commandFile)}`,
    '---',
    '',
    `# Imported Plugin Command: /${commandName}`,
    '',
    `This skill was generated from the ${pluginName} plugin command \`${path.basename(commandFile)}\`.`,
    '',
    body,
    '',
  ];

  return {skillName, skillContent: `${lines.join('\n')}\n`};
}

function normalizeCommandName(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || undefined;
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function normalizeScalar(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function escapeYamlScalar(value: string): string {
  return JSON.stringify(value);
}
