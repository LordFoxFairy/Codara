import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface RemoteAgentConfig {
  name: string;
  url: string;
  capabilities?: string[];
  auth?: {
    type: 'bearer' | 'oauth2' | 'apiKey';
    token?: string;
    tokenUrl?: string;
    clientId?: string;
    clientSecret?: string;
    apiKey?: string;
  };
}

interface RemotesFile {
  remoteAgents: RemoteAgentConfig[];
}

export class RemotePool {
  private agents: RemoteAgentConfig[] = [];
  private filePath: string;

  constructor(configDir?: string) {
    this.filePath = path.join(configDir ?? path.join(os.homedir(), '.codara'), 'remotes.json');
  }

  /** Load pool from disk. Returns empty if file doesn't exist. */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const data: RemotesFile = JSON.parse(content);
      this.agents = data.remoteAgents ?? [];
    } catch {
      this.agents = [];
    }
  }

  /** Save pool to disk. */
  async save(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify({ remoteAgents: this.agents }, null, 2));
  }

  getRemote(name: string): RemoteAgentConfig | undefined {
    return this.agents.find(a => a.name === name);
  }

  listRemotes(): RemoteAgentConfig[] {
    return [...this.agents];
  }

  async addRemote(config: RemoteAgentConfig): Promise<void> {
    if (this.agents.some(a => a.name === config.name)) {
      throw new Error(`Remote "${config.name}" already exists`);
    }
    this.agents.push(config);
    await this.save();
  }

  async removeRemote(name: string): Promise<void> {
    const idx = this.agents.findIndex(a => a.name === name);
    if (idx === -1) throw new Error(`Remote "${name}" not found`);
    this.agents.splice(idx, 1);
    await this.save();
  }
}
