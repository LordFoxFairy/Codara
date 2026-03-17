import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {TeamSchema} from '@capability/team/types';
import type {Team} from '@capability/team/types';

export class TeamStore {
  constructor(private readonly baseDir: string) {}

  private teamDir(teamId: string): string {
    return join(this.baseDir, teamId);
  }

  private teamPath(teamId: string): string {
    return join(this.teamDir(teamId), 'team.json');
  }

  private registryPath(): string {
    return join(this.baseDir, 'registry.json');
  }

  /** Save a team (atomic: write temp -> rename) */
  save(team: Team): void {
    const dir = this.teamDir(team.teamId);
    if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
    const path = this.teamPath(team.teamId);
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(team, null, 2));
    renameSync(tmp, path);
  }

  /** Load a team by ID */
  load(teamId: string): Team | undefined {
    const path = this.teamPath(teamId);
    if (!existsSync(path)) return undefined;
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return TeamSchema.parse(data);
  }

  /** Save registry index (list of team summaries) */
  saveRegistry(teams: Team[]): void {
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, {recursive: true});
    const path = this.registryPath();
    const tmp = path + '.tmp';
    const entries = teams.map((t) => ({
      teamId: t.teamId,
      name: t.name,
      status: t.status,
      goal: t.goal,
      depth: t.depth,
      createdAt: t.createdAt,
    }));
    writeFileSync(tmp, JSON.stringify(entries, null, 2));
    renameSync(tmp, path);
  }

  /** Load registry index */
  loadRegistry(): Array<{teamId: string; name: string; status: string}> {
    const path = this.registryPath();
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  /** Delete a team's data */
  delete(teamId: string): void {
    const dir = this.teamDir(teamId);
    if (existsSync(dir)) {
      rmSync(dir, {recursive: true, force: true});
    }
  }
}
