import chalk from 'chalk';
import { CommitInfo, ChurnedFile } from './git.js';
import { Analysis } from './analyzer.js';

const typeColors: Record<string, (s: string) => string> = {
  feature: chalk.green,
  fix: chalk.red,
  refactor: chalk.blue,
  docs: chalk.cyan,
  test: chalk.magenta,
  chore: chalk.gray,
  unknown: chalk.white,
};

const typeIcons: Record<string, string> = {
  feature: '✦',
  fix: '●',
  refactor: '◆',
  docs: '◇',
  test: '▲',
  chore: '○',
  unknown: '·',
};

export function renderTimeline(commits: CommitInfo[], analysis: Analysis, filePath: string): void {
  // Header
  console.log(chalk.bold('  ┌──────────────────────────────────────────────────┐'));
  console.log(chalk.bold('  │            FLUX — FILE TIMELINE                  │'));
  console.log(chalk.bold('  └──────────────────────────────────────────────────┘'));
  console.log();

  // Stats
  console.log(`  ${chalk.bold(filePath)}`);
  console.log();
  console.log(`  Commits: ${chalk.bold(analysis.totalCommits.toString())}  |  Churn: ${getChurnColor(analysis.churnScore)(`${analysis.churnScore}`)}  |  Trend: ${getTrendIcon(analysis.complexityTrend)}  |  Avg change: ${chalk.dim(`${analysis.averageChangeSize} lines`)}`);
  console.log(`  Expert: ${chalk.cyan.bold(analysis.currentExpert)}  |  Contributors: ${chalk.dim(analysis.ownership.length.toString())}`);
  console.log();

  // Patterns
  if (analysis.patterns.length > 0) {
    console.log(chalk.bold('  Patterns Detected:'));
    for (const p of analysis.patterns) {
      const color = p.severity === 'high' ? chalk.red : p.severity === 'medium' ? chalk.yellow : chalk.green;
      console.log(`  ${color('●')} ${p.description}`);
    }
    console.log();
  }

  // Ownership
  console.log(chalk.bold('  Ownership:'));
  for (const o of analysis.ownership.slice(0, 5)) {
    const bar = '█'.repeat(Math.max(1, Math.round(o.percentage / 5)));
    console.log(`  ${chalk.dim(o.author.padEnd(20))} ${chalk.cyan(bar)} ${o.percentage}% (${o.commits})`);
  }
  console.log();

  // Commit type distribution
  console.log(chalk.bold('  Change Types:'));
  const types = Object.entries(analysis.commitTypes).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of types) {
    const color = typeColors[type] || chalk.white;
    const pct = Math.round((count / analysis.totalCommits) * 100);
    const bar = '█'.repeat(Math.max(1, Math.round(pct / 5)));
    console.log(`  ${color(`${typeIcons[type] || '·'} ${type.padEnd(10)}`)} ${bar} ${pct}%`);
  }
  console.log();

  // Timeline
  console.log(chalk.bold('  Timeline:'));
  console.log(chalk.dim('  ─'.repeat(30)));

  let lastDate = '';
  for (const commit of commits.slice(0, 30)) {
    const dateStr = commit.date;
    const showDate = dateStr !== lastDate;
    lastDate = dateStr;

    const color = typeColors[commit.changeType] || chalk.white;
    const icon = typeIcons[commit.changeType] || '·';
    const stats = `${chalk.green(`+${commit.additions}`)} ${chalk.red(`-${commit.deletions}`)}`;

    if (showDate) {
      console.log(chalk.dim(`  │`));
      console.log(chalk.dim(`  ├── ${dateStr}`));
    }

    console.log(`  │  ${color(icon)} ${commit.message.substring(0, 60).padEnd(60)} ${stats} ${chalk.dim(commit.author)}`);
  }
  console.log(chalk.dim('  │'));
  if (commits.length > 30) {
    console.log(chalk.dim(`  └── ... and ${commits.length - 30} more commits`));
  } else {
    console.log(chalk.dim('  └── (start of history)'));
  }
  console.log();

  // Stability
  if (analysis.stabilityPeriods.length > 0) {
    console.log(chalk.bold('  Stability Periods (>30 days untouched):'));
    for (const sp of analysis.stabilityPeriods.slice(0, 5)) {
      console.log(chalk.dim(`  ${sp.start} → ${sp.end} (${sp.days} days)`));
    }
    console.log();
  }

  // Legend
  console.log(chalk.dim('  Legend: ') +
    Object.entries(typeIcons).map(([type, icon]) =>
      (typeColors[type] || chalk.white)(`${icon} ${type}`)
    ).join(chalk.dim(' | ')));
  console.log();
}

export function renderTopChurned(files: ChurnedFile[]): void {
  console.log(chalk.bold('  ┌──────────────────────────────────────────────────┐'));
  console.log(chalk.bold('  │         TOP CHURNED FILES                        │'));
  console.log(chalk.bold('  └──────────────────────────────────────────────────┘'));
  console.log();

  console.log(chalk.dim('  #  Churn  Commits  Authors  Last Modified  File'));
  console.log(chalk.dim('  ─'.repeat(40)));

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const churnColor = getChurnColor(f.churnScore);
    const rank = chalk.dim(`${(i + 1).toString().padStart(2)}.`);
    const churn = churnColor(f.churnScore.toString().padStart(6));
    const commits = chalk.bold(f.commits.toString().padStart(8));
    const authors = chalk.dim(f.authors.toString().padStart(8));
    const date = chalk.dim(f.lastModified.padStart(12));

    console.log(`  ${rank} ${churn} ${commits} ${authors}  ${date}  ${f.path}`);
  }

  console.log();
  console.log(chalk.dim('  Churn = commits × log2(authors). Higher = more volatile.'));
  console.log(chalk.dim('  Run flux <file> to see detailed timeline.\n'));
}

function getChurnColor(score: number): (s: string) => string {
  if (score > 5) return chalk.red.bold;
  if (score > 2) return chalk.yellow;
  return chalk.green;
}

function getTrendIcon(trend: string): string {
  if (trend === 'growing') return chalk.red('↑ growing');
  if (trend === 'shrinking') return chalk.green('↓ shrinking');
  return chalk.blue('→ stable');
}
