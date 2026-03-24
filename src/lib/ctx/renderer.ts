import chalk from 'chalk';
import { RelevantFile } from './relevance.js';
import { GitCommit } from './git.js';
import { TestFile } from './tests.js';
import { Warning } from './warnings.js';

interface Briefing {
  query: string;
  relevantFiles: RelevantFile[];
  gitHistory: GitCommit[];
  tests: TestFile[];
  warnings: Warning[];
}

export function renderBriefing(briefing: Briefing, compact?: boolean): void {
  const { query, relevantFiles, gitHistory, tests, warnings } = briefing;

  console.log(chalk.bold.cyan('  ┌─────────────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('  │           CONTEXT BRIEFING                      │'));
  console.log(chalk.bold.cyan('  └─────────────────────────────────────────────────┘'));
  console.log();
  console.log(chalk.dim(`  Task: "${query}"`));
  console.log();

  // Start Here
  console.log(chalk.bold.green('  🎯 START HERE'));
  console.log(chalk.dim('  ─'.repeat(25)));
  const topFiles = relevantFiles.slice(0, 5);
  for (const f of topFiles) {
    console.log(`  ${chalk.bold(f.relativePath)} ${chalk.dim(`(score: ${f.score})`)}`);
    console.log(chalk.dim(`    ${f.reasons.slice(0, 3).join(', ')}`));
  }
  console.log();

  // Context Files
  if (relevantFiles.length > 5) {
    console.log(chalk.bold.blue('  📚 CONTEXT FILES'));
    console.log(chalk.dim('  ─'.repeat(25)));
    for (const f of relevantFiles.slice(5)) {
      console.log(`  ${chalk.dim('•')} ${f.relativePath} ${chalk.dim(`(score: ${f.score})`)}`);
    }
    console.log();
  }

  // Recent Changes
  if (gitHistory.length > 0) {
    console.log(chalk.bold.yellow('  📜 RECENT CHANGES'));
    console.log(chalk.dim('  ─'.repeat(25)));
    for (const commit of gitHistory.slice(0, 10)) {
      console.log(`  ${chalk.dim(commit.hash)} ${chalk.cyan(commit.date)} ${chalk.dim(commit.author)}`);
      console.log(`    ${commit.message}`);
    }
    console.log();
  }

  // Test Coverage
  console.log(chalk.bold.magenta('  🧪 TEST FILES'));
  console.log(chalk.dim('  ─'.repeat(25)));
  if (tests.length > 0) {
    for (const t of tests) {
      console.log(`  ${chalk.green('✓')} ${t.relativePath} ${chalk.dim(`(tests ${t.sourceFile})`)}`);
    }
  } else {
    console.log(chalk.yellow('  ⚠ No related test files found — consider adding tests!'));
  }
  console.log();

  // Warnings
  if (warnings.length > 0) {
    console.log(chalk.bold.red('  ⚠ WATCH OUT'));
    console.log(chalk.dim('  ─'.repeat(25)));
    for (const w of warnings.slice(0, 15)) {
      const color = w.type === 'FIXME' ? chalk.red : w.type === 'HACK' ? chalk.yellow : chalk.dim;
      console.log(`  ${color(`[${w.type}]`)} ${w.message}`);
      console.log(chalk.dim(`    ${w.file}:${w.line}`));
    }
    if (warnings.length > 15) {
      console.log(chalk.dim(`  ... and ${warnings.length - 15} more`));
    }
    console.log();
  }

  console.log(chalk.dim('  ─'.repeat(25)));
  console.log(chalk.dim('  Use --output briefing.md to save | --clipboard to copy\n'));
}

export function renderMarkdown(briefing: Briefing): string {
  const { query, relevantFiles, gitHistory, tests, warnings } = briefing;
  const lines: string[] = [];

  lines.push(`# Context Briefing`);
  lines.push(`> Task: "${query}"`);
  lines.push(``);

  lines.push(`## 🎯 Start Here`);
  for (const f of relevantFiles.slice(0, 5)) {
    lines.push(`- **\`${f.relativePath}\`** (score: ${f.score}) — ${f.reasons.slice(0, 2).join(', ')}`);
  }
  lines.push(``);

  if (relevantFiles.length > 5) {
    lines.push(`## 📚 Context Files`);
    for (const f of relevantFiles.slice(5)) {
      lines.push(`- \`${f.relativePath}\` (score: ${f.score})`);
    }
    lines.push(``);
  }

  if (gitHistory.length > 0) {
    lines.push(`## 📜 Recent Changes`);
    lines.push(`| Hash | Date | Author | Message |`);
    lines.push(`|------|------|--------|---------|`);
    for (const c of gitHistory.slice(0, 10)) {
      lines.push(`| ${c.hash} | ${c.date} | ${c.author} | ${c.message} |`);
    }
    lines.push(``);
  }

  lines.push(`## 🧪 Test Files`);
  if (tests.length > 0) {
    for (const t of tests) {
      lines.push(`- ✅ \`${t.relativePath}\` → tests \`${t.sourceFile}\``);
    }
  } else {
    lines.push(`- ⚠️ No related test files found`);
  }
  lines.push(``);

  if (warnings.length > 0) {
    lines.push(`## ⚠️ Watch Out`);
    for (const w of warnings) {
      lines.push(`- **[${w.type}]** ${w.message} (\`${w.file}:${w.line}\`)`);
    }
    lines.push(``);
  }

  return lines.join('\n');
}
