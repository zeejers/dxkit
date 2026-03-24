import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

export function ctxCommand(): Command {
  const cmd = new Command('ctx')
    .description('Compile a context briefing before starting any task')
    .argument('<query>', 'Natural language task description')
    .option('-p, --path <dir>', 'Project root', '.')
    .option('-n, --max-files <n>', 'Max files to include', '15')
    .option('--clipboard', 'Copy to clipboard')
    .option('-o, --output <file>', 'Save to file')
    .option('--json', 'JSON output')
    .option('--compact', 'Compact output (paths only)')
    .action(async (query: string, opts) => {
      const { findRelevantFiles } = await import('../lib/ctx/relevance.js');
      const { getGitHistory } = await import('../lib/ctx/git.js');
      const { findRelatedTests } = await import('../lib/ctx/tests.js');
      const { findWarnings } = await import('../lib/ctx/warnings.js');
      const { renderBriefing, renderMarkdown } = await import('../lib/ctx/renderer.js');

      console.log(chalk.bold.magenta('\n  dx ctx') + chalk.dim(` — Context Compiler\n`));
      console.log(chalk.dim(`  Task: "${query}"`));
      console.log(chalk.dim(`  Scanning: ${opts.path}\n`));

      const maxFiles = parseInt(opts.maxFiles);

      process.stdout.write(chalk.yellow('  ◐ Finding relevant files...'));
      const relevantFiles = await findRelevantFiles(query, opts.path, maxFiles);
      process.stdout.write(`\r${chalk.green('  ✓')} Found ${chalk.bold(relevantFiles.length.toString())} relevant files\n`);

      process.stdout.write(chalk.yellow('  ◐ Pulling git history...'));
      const gitHistory = await getGitHistory(relevantFiles.map(f => f.path), opts.path);
      process.stdout.write(`\r${chalk.green('  ✓')} Got ${chalk.bold(gitHistory.length.toString())} recent commits\n`);

      process.stdout.write(chalk.yellow('  ◐ Finding related tests...'));
      const tests = await findRelatedTests(relevantFiles.map(f => f.path), opts.path);
      process.stdout.write(`\r${chalk.green('  ✓')} Found ${chalk.bold(tests.length.toString())} related test files\n`);

      process.stdout.write(chalk.yellow('  ◐ Scanning for warnings...'));
      const warnings = await findWarnings(relevantFiles.map(f => f.path));
      process.stdout.write(`\r${chalk.green('  ✓')} Found ${chalk.bold(warnings.length.toString())} warnings\n\n`);

      const briefing = { query, relevantFiles, gitHistory, tests, warnings };

      if (opts.json) {
        console.log(JSON.stringify(briefing, null, 2));
        return;
      }

      const markdown = renderMarkdown(briefing);
      renderBriefing(briefing, opts.compact);

      if (opts.output) {
        writeFileSync(opts.output, markdown);
        console.log(chalk.green(`  ✓ Saved to ${opts.output}\n`));
      }

      if (opts.clipboard) {
        try {
          execSync('pbcopy', { input: markdown });
          console.log(chalk.green('  ✓ Copied to clipboard!\n'));
        } catch {
          try {
            execSync('xclip -selection clipboard', { input: markdown });
            console.log(chalk.green('  ✓ Copied to clipboard!\n'));
          } catch {
            console.log(chalk.yellow('  ⚠ Could not copy (pbcopy/xclip not found)\n'));
          }
        }
      }
    });

  return cmd;
}
