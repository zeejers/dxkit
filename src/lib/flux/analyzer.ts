import { CommitInfo } from './git.js';

export interface Analysis {
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
  churnScore: number;
  complexityTrend: 'growing' | 'shrinking' | 'stable';
  ownership: { author: string; commits: number; percentage: number }[];
  currentExpert: string;
  stabilityPeriods: { start: string; end: string; days: number }[];
  patterns: Pattern[];
  commitTypes: Record<string, number>;
  averageChangeSize: number;
  longestStable: number; // days
}

export interface Pattern {
  type: 'revert_cycle' | 'bug_magnet' | 'growing_complexity' | 'abandoned_experiment' | 'stable';
  description: string;
  severity: 'high' | 'medium' | 'low';
}

export function analyzeHistory(commits: CommitInfo[], filePath: string): Analysis {
  const totalCommits = commits.length;
  const totalAdditions = commits.reduce((s, c) => s + c.additions, 0);
  const totalDeletions = commits.reduce((s, c) => s + c.deletions, 0);

  // Ownership
  const authorCounts = new Map<string, number>();
  for (const c of commits) {
    authorCounts.set(c.author, (authorCounts.get(c.author) || 0) + 1);
  }
  const ownership = [...authorCounts.entries()]
    .map(([author, count]) => ({
      author,
      commits: count,
      percentage: Math.round((count / totalCommits) * 100),
    }))
    .sort((a, b) => b.commits - a.commits);

  const currentExpert = ownership[0]?.author || 'unknown';

  // Complexity trend
  const netChange = totalAdditions - totalDeletions;
  const complexityTrend = netChange > totalAdditions * 0.3 ? 'growing'
    : netChange < -totalDeletions * 0.3 ? 'shrinking'
    : 'stable';

  // Stability periods
  const stabilityPeriods: Analysis['stabilityPeriods'] = [];
  const sortedCommits = [...commits].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sortedCommits.length; i++) {
    const prev = new Date(sortedCommits[i - 1].date);
    const curr = new Date(sortedCommits[i].date);
    const days = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (days > 30) {
      stabilityPeriods.push({
        start: sortedCommits[i - 1].date,
        end: sortedCommits[i].date,
        days,
      });
    }
  }

  const longestStable = stabilityPeriods.length > 0
    ? Math.max(...stabilityPeriods.map(s => s.days))
    : 0;

  // Commit type distribution
  const commitTypes: Record<string, number> = {};
  for (const c of commits) {
    commitTypes[c.changeType] = (commitTypes[c.changeType] || 0) + 1;
  }

  // Average change size
  const averageChangeSize = totalCommits > 0
    ? Math.round((totalAdditions + totalDeletions) / totalCommits)
    : 0;

  // Churn score (higher = more volatile)
  const uniqueAuthors = authorCounts.size;
  const daySpan = sortedCommits.length >= 2
    ? Math.max(1, Math.round((new Date(sortedCommits[sortedCommits.length - 1].date).getTime() - new Date(sortedCommits[0].date).getTime()) / (1000 * 60 * 60 * 24)))
    : 1;
  const churnScore = Math.round((totalCommits / daySpan) * 100 * (1 + Math.log2(uniqueAuthors))) / 100;

  // Pattern detection
  const patterns: Pattern[] = [];

  // Bug magnet
  const fixCount = commitTypes['fix'] || 0;
  if (fixCount > totalCommits * 0.4 && fixCount >= 3) {
    patterns.push({
      type: 'bug_magnet',
      description: `${fixCount} of ${totalCommits} commits (${Math.round(fixCount / totalCommits * 100)}%) are bug fixes — this file attracts bugs`,
      severity: 'high',
    });
  }

  // Growing complexity
  if (complexityTrend === 'growing' && totalAdditions > 200) {
    patterns.push({
      type: 'growing_complexity',
      description: `File has grown by ${totalAdditions - totalDeletions} net lines — consider refactoring`,
      severity: 'medium',
    });
  }

  // Revert cycles (many small back-and-forth changes)
  let revertLike = 0;
  for (let i = 1; i < commits.length; i++) {
    if (commits[i].additions > 0 && commits[i].deletions > 0 &&
        Math.abs(commits[i].additions - commits[i - 1].deletions) < 5) {
      revertLike++;
    }
  }
  if (revertLike > 3) {
    patterns.push({
      type: 'revert_cycle',
      description: `Detected ${revertLike} potential revert-like changes — code may be cycling back and forth`,
      severity: 'medium',
    });
  }

  // Stable
  if (patterns.length === 0 && longestStable > 90) {
    patterns.push({
      type: 'stable',
      description: `File has been stable with ${longestStable}-day stretches of no changes`,
      severity: 'low',
    });
  }

  return {
    totalCommits,
    totalAdditions,
    totalDeletions,
    churnScore,
    complexityTrend,
    ownership,
    currentExpert,
    stabilityPeriods,
    patterns,
    commitTypes,
    averageChangeSize,
    longestStable,
  };
}
