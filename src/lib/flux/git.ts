import { execSync } from 'child_process';

export interface CommitInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
  additions: number;
  deletions: number;
  changeType: 'feature' | 'fix' | 'refactor' | 'docs' | 'test' | 'chore' | 'unknown';
}

export interface ChurnedFile {
  path: string;
  commits: number;
  authors: number;
  additions: number;
  deletions: number;
  churnScore: number;
  lastModified: string;
}

export async function getFileHistory(filePath: string, maxCommits: number, since?: string): Promise<CommitInfo[]> {
  const sinceArg = since ? `--since="${since}"` : '';
  const raw = execSync(
    `git log --follow -n ${maxCommits} ${sinceArg} --pretty=format:"%H|||%an|||%ai|||%s" --numstat -- "${filePath}"`,
    { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
  );

  const commits: CommitInfo[] = [];
  const blocks = raw.split('\n\n').filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines[0]) continue;

    const [hash, author, date, message] = lines[0].split('|||');
    if (!hash) continue;

    let additions = 0;
    let deletions = 0;

    for (let i = 1; i < lines.length; i++) {
      const stat = lines[i].match(/^(\d+|-)\s+(\d+|-)\s+/);
      if (stat) {
        additions += stat[1] === '-' ? 0 : parseInt(stat[1]);
        deletions += stat[2] === '-' ? 0 : parseInt(stat[2]);
      }
    }

    commits.push({
      hash: hash.substring(0, 8),
      author,
      date: date.substring(0, 10),
      message,
      additions,
      deletions,
      changeType: classifyCommit(message),
    });
  }

  return commits;
}

export async function getTopChurned(max: number, since?: string): Promise<ChurnedFile[]> {
  const sinceArg = since ? `--since="${since}"` : '--since="1 year ago"';
  const raw = execSync(
    `git log ${sinceArg} --pretty=format:"%H|||%an|||%ai" --name-only`,
    { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 }
  );

  const fileStats = new Map<string, { commits: Set<string>; authors: Set<string>; lastDate: string }>();

  const blocks = raw.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const header = lines[0]?.split('|||');
    if (!header || header.length < 3) continue;

    const [hash, author, date] = header;

    for (let i = 1; i < lines.length; i++) {
      const file = lines[i].trim();
      if (!file || file.includes('|||')) continue;

      if (!fileStats.has(file)) {
        fileStats.set(file, { commits: new Set(), authors: new Set(), lastDate: date });
      }
      const stats = fileStats.get(file)!;
      stats.commits.add(hash);
      stats.authors.add(author);
      if (date > stats.lastDate) stats.lastDate = date;
    }
  }

  const churned: ChurnedFile[] = [];
  for (const [path, stats] of fileStats) {
    if (path.includes('node_modules/') || path.includes('package-lock') || path.includes('yarn.lock')) continue;

    const churnScore = stats.commits.size * (1 + Math.log2(stats.authors.size));
    churned.push({
      path,
      commits: stats.commits.size,
      authors: stats.authors.size,
      additions: 0, // Would need per-file stats
      deletions: 0,
      churnScore: Math.round(churnScore * 10) / 10,
      lastModified: stats.lastDate.substring(0, 10),
    });
  }

  churned.sort((a, b) => b.churnScore - a.churnScore);
  return churned.slice(0, max);
}

function classifyCommit(message: string): CommitInfo['changeType'] {
  const msg = message.toLowerCase();
  if (msg.match(/\bfix(?:es|ed)?\b|bug|patch|hotfix|resolve/)) return 'fix';
  if (msg.match(/\bfeat(?:ure)?\b|add(?:ed|s)?\b|implement|new\b/)) return 'feature';
  if (msg.match(/\brefactor|clean|restructure|reorganize|simplif/)) return 'refactor';
  if (msg.match(/\bdoc(?:s|umentation)?\b|readme|comment/)) return 'docs';
  if (msg.match(/\btest(?:s|ing)?\b|spec|coverage/)) return 'test';
  if (msg.match(/\bchore|bump|update dep|upgrade|config/)) return 'chore';
  return 'unknown';
}
