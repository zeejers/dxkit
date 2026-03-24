import chalk from 'chalk';
import { DuplicateGroup } from './duplicates.js';
import { Inconsistency } from './inconsistencies.js';
import { UnusedExport } from './unused.js';

interface Results {
  duplicates: DuplicateGroup[];
  inconsistencies: Inconsistency[];
  unused: UnusedExport[];
}

export function renderReport(results: Results, totalFiles: number): void {
  const { duplicates, inconsistencies, unused } = results;

  // Tech debt score
  const debtScore = Math.min(100,
    duplicates.reduce((s, d) => s + d.estimatedLinesSaved, 0) * 0.5 +
    inconsistencies.length * 10 +
    unused.length * 2
  );
  const debtColor = debtScore < 20 ? chalk.green.bold : debtScore < 50 ? chalk.yellow.bold : chalk.red.bold;

  console.log(chalk.bold('  ┌──────────────────────────────────────────────────┐'));
  console.log(chalk.bold('  │          HARVEST — PATTERN REPORT                │'));
  console.log(chalk.bold('  └──────────────────────────────────────────────────┘'));
  console.log();
  console.log(`  Files scanned: ${chalk.bold(totalFiles.toString())}  |  Tech debt score: ${debtColor(`${Math.round(debtScore)}/100`)}`);
  console.log(`  ${chalk.cyan(`${duplicates.length} duplicate groups`)}  |  ${chalk.yellow(`${inconsistencies.length} inconsistencies`)}  |  ${chalk.dim(`${unused.length} unused exports`)}`);
  console.log();

  // Duplicates
  if (duplicates.length > 0) {
    const totalSaved = duplicates.reduce((s, d) => s + d.estimatedLinesSaved, 0);
    console.log(chalk.bold.cyan(`  ── DUPLICATES (${duplicates.length} groups, ~${totalSaved} lines saveable) ${'─'.repeat(15)}`));
    console.log();

    for (const group of duplicates.slice(0, 10)) {
      const simColor = group.similarity === 100 ? chalk.red.bold : chalk.yellow;
      console.log(`  ${simColor(`${group.similarity}% similar`)} — ${chalk.dim(`~${group.estimatedLinesSaved} lines`)}`);

      for (const func of group.functions) {
        console.log(`    ${chalk.dim('•')} ${chalk.bold(func.name)} in ${func.file}:${func.startLine}-${func.endLine}`);
      }

      // Show first few lines of first function as preview
      const preview = group.functions[0].body.split('\n').slice(0, 4).map(l => chalk.dim(`      ${l}`)).join('\n');
      console.log(preview);
      console.log();
    }

    if (duplicates.length > 10) {
      console.log(chalk.dim(`  ... and ${duplicates.length - 10} more duplicate groups\n`));
    }
  }

  // Inconsistencies
  if (inconsistencies.length > 0) {
    console.log(chalk.bold.yellow(`  ── INCONSISTENCIES (${inconsistencies.length}) ${'─'.repeat(25)}`));
    console.log();

    for (const inc of inconsistencies) {
      console.log(`  ${chalk.yellow('⚠')} ${inc.description}`);
      for (const ex of inc.examples.slice(0, 3)) {
        console.log(chalk.dim(`    ${ex.file}${ex.line ? `:${ex.line}` : ''} — ${ex.code}`));
      }
      console.log(chalk.dim.italic(`    → ${inc.suggestion}`));
      console.log();
    }
  }

  // Unused exports
  if (unused.length > 0) {
    console.log(chalk.bold.dim(`  ── UNUSED EXPORTS (${unused.length}) ${'─'.repeat(25)}`));
    console.log();

    for (const u of unused.slice(0, 20)) {
      console.log(`  ${chalk.dim('◎')} ${chalk.bold(u.name)} ${chalk.dim(`(${u.type})`)} in ${u.file}:${u.line}`);
    }
    if (unused.length > 20) {
      console.log(chalk.dim(`  ... and ${unused.length - 20} more`));
    }
    console.log();
  }

  // Refactoring plan
  if (duplicates.length > 0 || inconsistencies.length > 0) {
    console.log(chalk.bold.green('  ── REFACTORING PLAN ─────────────────────────────'));
    console.log();

    let priority = 1;
    for (const group of duplicates.slice(0, 5)) {
      console.log(`  ${chalk.bold(`${priority}.`)} Extract shared function from ${group.functions.map(f => chalk.cyan(f.name)).join(' & ')}`);
      console.log(chalk.dim(`     Impact: ~${group.estimatedLinesSaved} lines reduced | Files: ${[...new Set(group.functions.map(f => f.file))].join(', ')}`));
      priority++;
    }

    for (const inc of inconsistencies) {
      console.log(`  ${chalk.bold(`${priority}.`)} ${inc.suggestion}`);
      console.log(chalk.dim(`     Affects: ${inc.examples.length}+ files`));
      priority++;
    }
    console.log();
  }

  console.log(chalk.dim('  ─'.repeat(25)));
  console.log(chalk.dim(`  Run with ${chalk.bold('--report report.md')} to save as markdown`));
  console.log(chalk.dim(`  Run with ${chalk.bold('--min-similarity 90')} to be stricter\n`));
}

export function renderMarkdownReport(results: Results, totalFiles: number): string {
  const { duplicates, inconsistencies, unused } = results;
  const lines: string[] = [];

  lines.push('# Harvest — Pattern Report\n');
  lines.push(`- Files scanned: ${totalFiles}`);
  lines.push(`- Duplicate groups: ${duplicates.length}`);
  lines.push(`- Inconsistencies: ${inconsistencies.length}`);
  lines.push(`- Unused exports: ${unused.length}\n`);

  if (duplicates.length > 0) {
    lines.push('## Duplicates\n');
    for (const g of duplicates) {
      lines.push(`### ${g.similarity}% similar (~${g.estimatedLinesSaved} lines saveable)\n`);
      for (const f of g.functions) {
        lines.push(`- \`${f.name}\` in \`${f.file}:${f.startLine}\``);
      }
      lines.push('');
    }
  }

  if (inconsistencies.length > 0) {
    lines.push('## Inconsistencies\n');
    for (const inc of inconsistencies) {
      lines.push(`### ${inc.description}\n`);
      lines.push(`**Suggestion:** ${inc.suggestion}\n`);
    }
  }

  if (unused.length > 0) {
    lines.push('## Unused Exports\n');
    for (const u of unused) {
      lines.push(`- \`${u.name}\` (${u.type}) in \`${u.file}:${u.line}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}
