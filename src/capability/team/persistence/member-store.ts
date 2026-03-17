import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {TeamMemberSchema} from '@capability/team/types';
import type {TeamMember} from '@capability/team/types';

/** @deprecated Use {@link import('./team-persistence').TeamPersistence} instead. */
export class MemberStore {
  constructor(private readonly baseDir: string) {}

  private membersDir(teamId: string): string {
    return join(this.baseDir, teamId, 'members');
  }

  private memberPath(teamId: string, memberId: string): string {
    return join(this.membersDir(teamId), `${memberId}.json`);
  }

  save(member: TeamMember): void {
    const dir = this.membersDir(member.teamId);
    if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
    const path = this.memberPath(member.teamId, member.memberId);
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(member, null, 2));
    renameSync(tmp, path);
  }

  load(teamId: string, memberId: string): TeamMember | undefined {
    const path = this.memberPath(teamId, memberId);
    if (!existsSync(path)) return undefined;
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return TeamMemberSchema.parse(data);
  }

  loadByTeam(teamId: string): TeamMember[] {
    const dir = this.membersDir(teamId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        return TeamMemberSchema.parse(data);
      });
  }

  delete(teamId: string, memberId: string): void {
    const path = this.memberPath(teamId, memberId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}
