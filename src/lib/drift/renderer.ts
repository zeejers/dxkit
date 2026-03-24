import chalk from 'chalk';
import Table from 'cli-table3';
import { Finding, Severity } from './analyzer.js';
import { SymbolInfo } from './symbols.js';

const severityColors: Record<Severity, (s: string) => string> = {
  BROKEN: chalk.red.bold,
  STALE: chalk.yellow.bold,
  MISSING: chalk.blue,
  OK: chalk.green,
};

const severityIcons: Record<Severity, string> = {
  BROKEN: '  ✖',
  STALE: '  ⚠',
  MISSING: '  ◎',
  OK: '  ✓',
};

export function renderReport(findings: Finding[], symbols: Map<string, SymbolInfo>): void {
  // Summary stats
  const counts: Record<Severity, number> = { BROKEN: 0, STALE: 0, MISSING: 0, OK: 0 };
  for (const f of findings) counts[f.severity]++;
  const totalExports = [...symbols.values()].filter(s => s.exported).length;
  const docCoverage = totalExports > 0
    ? Math.round(((totalExports - counts.MISSING) / totalExports) * 100)
    : 100;

  // Header
  console.log(chalk.bold('  ┌─────────────────────────────────────────────┐'));
  console.log(chalk.bold('  │         DRIFT ANALYSIS REPORT               │'));
  console.log(chalk.bold('  └─────────────────────────────────────────────┘'));
  console.log();

  // Score
  const score = getScore(counts);
  const scoreColor = score >= 90 ? chalk.green.bold : score >= 70 ? chalk.yellow.bold : chalk.red.bold;
  console.log(`  Documentation Health: ${scoreColor(`${score}/100`)}  |  Coverage: ${chalk.cyan(`${docCoverage}%`)} of exports documented`);
  console.log();

  // Summary bar
  console.log(`  ${chalk.red.bold(`${counts.BROKEN} BROKEN`)}  ${chalk.yellow.bold(`${counts.STALE} STALE`)}  ${chalk.blue(`${counts.MISSING} MISSING`)}`);
  console.log();

  if (findings.length === 0) {
    console.log(chalk.green.bold('  ✨ Perfect! No documentation drift detected.\n'));
    return;
  }

  // Group by severity
  for (const severity of ['BROKEN', 'STALE', 'MISSING'] as Severity[]) {
    const group = findings.filter(f => f.severity === severity);
    if (group.length === 0) continue;

    console.log(severityColors[severity](`  ── ${severity} (${group.length}) ${'─'.repeat(35)}`));
    console.log();

    for (const finding of group.slice(0, 20)) { // Cap at 20 per group
      console.log(`  ${severityIcons[severity]}  ${finding.message}`);
      console.log(chalk.dim(`     ${finding.docFile}${finding.line ? `:${finding.line}` : ''}`));
      if (finding.suggestion) {
        console.log(chalk.dim.italic(`     → ${finding.suggestion}`));
      }
      console.log();
    }

    if (group.length > 20) {
      console.log(chalk.dim(`     ... and ${group.length - 20} more ${severity} findings\n`));
    }
  }

  // Footer
  console.log(chalk.dim('  ─'.repeat(25)));
  console.log(chalk.dim(`  Run with ${chalk.bold('--fix')} to generate documentation patches`));
  console.log(chalk.dim(`  Run with ${chalk.bold('--json')} for machine-readable output`));
  console.log();
}

function getScore(counts: Record<Severity, number>): number {
  const penalties = counts.BROKEN * 10 + counts.STALE * 5 + counts.MISSING * 1;
  return Math.max(0, 100 - penalties);
}
