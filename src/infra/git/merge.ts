import {exec} from 'child_process';
import {promisify} from 'util';

const execAsync = promisify(exec);

export interface MergeResult {
  success: boolean;
  sourceBranch: string;
  targetBranch: string;
  conflictFiles?: string[];
  error?: string;
}

/** Merge a source branch into a target branch. */
export async function mergeBranch(
  sourceBranch: string,
  targetBranch: string,
  projectRoot: string,
  message?: string,
): Promise<MergeResult> {
  const msg = message ?? `Merge ${sourceBranch} into ${targetBranch}`;
  try {
    await execAsync(`git merge --no-ff "${sourceBranch}" -m "${msg}"`, {cwd: projectRoot});
    return {success: true, sourceBranch, targetBranch};
  } catch (err: any) {
    const stderr: string = err.stderr ?? '';
    const stdout: string = err.stdout ?? '';

    if (stderr.includes('CONFLICT') || stdout.includes('CONFLICT')) {
      const {stdout: statusOut} = await execAsync('git diff --name-only --diff-filter=U', {cwd: projectRoot});
      const conflictFiles = statusOut.trim().split('\n').filter(Boolean);
      await execAsync('git merge --abort', {cwd: projectRoot});
      return {success: false, sourceBranch, targetBranch, conflictFiles};
    }

    return {success: false, sourceBranch, targetBranch, error: err.message};
  }
}
