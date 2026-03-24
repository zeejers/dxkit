import chalk from 'chalk';
import { Finding, Severity, Diff } from './types.js';

const severityColors: Record<Severity, (s: string) => string> = {
  CRITICAL: chalk.red.bold,
  WARNING: chalk.yellow.bold,
  INFO: chalk.blue,
};

const severityIcons: Record<Severity, string> = {
  CRITICAL: '🚨',
  WARNING: '⚠️ ',
  INFO: 'ℹ️ ',
};

export function renderReport(findings: Finding[], diff: Diff): void {
  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const f of findings) counts[f.severity]++;

  // Grade
  const grade = getGrade(counts);
  const gradeColor = grade <= 'B' ? chalk.green.bold : grade <= 'D' ? chalk.yellow.bold : chalk.red.bold;

  console.log(chalk.bold('  ┌──────────────────────────────────────────────────┐'));
  console.log(chalk.bold('  │            REVIEW AUTOPILOT REPORT               │'));
  console.log(chalk.bold('  └──────────────────────────────────────────────────┘'));
  console.log();
  console.log(`  Grade: ${gradeColor(grade)}  |  ${chalk.red.bold(`${counts.CRITICAL} critical`)}  ${chalk.yellow.bold(`${counts.WARNING} warnings`)}  ${chalk.blue(`${counts.INFO} info`)}`);
  console.log(`  Files: ${diff.files.length}  |  ${chalk.green(`+${diff.additions}`)} ${chalk.red(`-${diff.deletions}`)}`);
  console.log();

  if (findings.length === 0) {
    console.log(chalk.green.bold('  ✨ Clean review! No issues found.\n'));
    return;
  }

  // Group by severity
  for (const severity of ['CRITICAL', 'WARNING', 'INFO'] as Severity[]) {
    const group = findings.filter(f => f.severity === severity);
    if (group.length === 0) continue;

    console.log(severityColors[severity](`  ── ${severity} (${group.length}) ${'─'.repeat(35)}`));
    console.log();

    // Group by pass within severity
    const byPass = new Map<string, Finding[]>();
    for (const f of group) {
      const arr = byPass.get(f.pass) || [];
      arr.push(f);
      byPass.set(f.pass, arr);
    }

    for (const [pass, passFindings] of byPass) {
      console.log(chalk.dim(`  [${pass}]`));
      for (const f of passFindings.slice(0, 10)) {
        console.log(`  ${severityIcons[severity]} ${f.message}`);
        console.log(chalk.dim(`     ${f.file}${f.line ? `:${f.line}` : ''}`));
        if (f.code) {
          console.log(chalk.dim(`     │ ${f.code.substring(0, 100)}`));
        }
        if (f.suggestion) {
          console.log(chalk.dim.italic(`     → ${f.suggestion}`));
        }
        console.log();
      }
      if (passFindings.length > 10) {
        console.log(chalk.dim(`     ... and ${passFindings.length - 10} more\n`));
      }
    }
  }

  console.log(chalk.dim('  ─'.repeat(25)));
  console.log(chalk.dim(`  Run with ${chalk.bold('--json')} for CI integration`));
  console.log(chalk.dim(`  Run with ${chalk.bold('--strict')} to fail on warnings`));
  console.log();
}

function getGrade(counts: Record<Severity, number>): string {
  const score = counts.CRITICAL * 20 + counts.WARNING * 5 + counts.INFO * 1;
  if (score === 0) return 'A';
  if (score <= 5) return 'B';
  if (score <= 15) return 'C';
  if (score <= 30) return 'D';
  return 'F';
}
