import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {JobBoard} from '@capability/team/job-board';

export class JobBoardStore {
  constructor(private readonly baseDir: string) {}

  private path(teamId: string): string {
    return join(this.baseDir, teamId, 'jobboard.json');
  }

  save(board: JobBoard): void {
    const data = board.toJSON();
    const dir = join(this.baseDir, data.teamId);
    if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
    const path = this.path(data.teamId);
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
  }

  load(teamId: string): JobBoard | undefined {
    const path = this.path(teamId);
    if (!existsSync(path)) return undefined;
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return JobBoard.fromJSON(data);
  }
}
