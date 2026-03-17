import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname} from 'node:path';

import type {TeamMessage} from '@capability/team/types';

export class MessageLog {
  constructor(private readonly path: string) {}

  /** Append a single message as a JSONL line */
  append(message: TeamMessage): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
    const line = JSON.stringify(message) + '\n';
    appendFileSync(this.path, line, 'utf-8');
  }

  /** Read all messages from the log */
  readAll(): TeamMessage[] {
    if (!existsSync(this.path)) return [];
    const content = readFileSync(this.path, 'utf-8');
    if (!content.trim()) return [];
    return content
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null; // discard partial lines (crash safety)
        }
      })
      .filter((m): m is TeamMessage => m !== null);
  }

  /** Read last N messages */
  readRecent(n: number): TeamMessage[] {
    const all = this.readAll();
    return all.slice(-n);
  }

  /** Check if log file exists */
  exists(): boolean {
    return existsSync(this.path);
  }
}
