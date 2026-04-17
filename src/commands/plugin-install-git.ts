/**
 * Git clone helper for plugin install.
 *
 * Spawns `git clone --depth 1` into a target directory and captures any stderr
 * output so failures surface meaningful error messages.
 *
 * @module
 */

import {spawn} from 'node:child_process';

export async function runGitClone(repoUrl: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['clone', '--depth', '1', repoUrl, destination], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      reject(new Error(`Failed to start git clone: ${error.message}`));
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `git clone failed with exit code ${code ?? -1}`));
    });
  });
}

export function isGitUrl(spec: string): boolean {
  return spec.startsWith('https://') || spec.startsWith('git@') || spec.startsWith('http://') || spec.endsWith('.git');
}

export function derivePluginNameFromUrl(url: string): string {
  const basename = url.replace(/\.git$/, '').split('/').pop() ?? 'plugin';
  return basename.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'plugin';
}
