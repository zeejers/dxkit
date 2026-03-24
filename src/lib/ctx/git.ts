import { execSync } from 'child_process';
import { relative, resolve } from 'path';

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  files: string[];
}

export async function getGitHistory(filePaths: string[], basePath: string): Promise<GitCommit[]> {
  const resolvedBase = resolve(basePath);

  try {
    // Check if we're in a git repo
    execSync('git rev-parse --is-inside-work-tree', { cwd: resolvedBase, stdio: 'pipe' });
  } catch {
    return [];
  }

  const relativePaths = filePaths.map(f => relative(resolvedBase, f));
  if (relativePaths.length === 0) return [];

  try {
    const fileArgs = relativePaths.slice(0, 20).join(' '); // Limit to avoid arg overflow
    const raw = execSync(
      `git log --pretty=format:"%H|||%an|||%ai|||%s" -n 20 -- ${fileArgs}`,
      { cwd: resolvedBase, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const commits: GitCommit[] = [];
    const lines = raw.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const [hash, author, date, message] = line.split('|||');
      if (!hash) continue;

      // Get files changed in this commit
      let files: string[] = [];
      try {
        const filesRaw = execSync(
          `git diff-tree --no-commit-id --name-only -r ${hash}`,
          { cwd: resolvedBase, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        files = filesRaw.trim().split('\n').filter(Boolean);
      } catch { /* skip */ }

      commits.push({
        hash: hash.substring(0, 8),
        author,
        date: date.substring(0, 10),
        message,
        files,
      });
    }

    return commits;
  } catch {
    return [];
  }
}
