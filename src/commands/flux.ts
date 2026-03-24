import { Command } from 'commander';
import chalk from 'chalk';

export function fluxCommand(): Command {
  const cmd = new Command('flux')
    .description('Git archaeology — track how any file evolved and why');

  cmd
    .command('file', { isDefault: true })
    .argument('[path]', 'File to analyze')
    .option('--since <date>', 'History since date (YYYY-MM-DD)')
    .option('--json', 'JSON output')
    .option('-n, --max <n>', 'Max commits', '50')
    .action(async (filePath: string | undefined, opts) => {
      if (!filePath) { cmd.help(); return; }

      const { getFileHistory } = await import('../lib/flux/git.js');
      const { analyzeHistory } = await import('../lib/flux/analyzer.js');
      const { renderTimeline } = await import('../lib/flux/renderer.js');

      console.log(chalk.bold.cyan('\n  dx flux') + chalk.dim(` — Codebase Time Machine\n`));
      console.log(chalk.dim(`  Analyzing: ${filePath}\n`));

      try {
        process.stdout.write(chalk.yellow('  ◐ Loading git history...'));
        const history = await getFileHistory(filePath, parseInt(opts.max), opts.since);
        process.stdout.write(`\r${chalk.green('  ✓')} ${chalk.bold(history.length.toString())} commits\n`);

        if (history.length === 0) {
          console.log(chalk.yellow('\n  No history found.\n'));
          return;
        }

        process.stdout.write(chalk.yellow('  ◐ Analyzing patterns...'));
        const analysis = analyzeHistory(history, filePath);
        process.stdout.write(`\r${chalk.green('  ✓')} Analysis complete\n\n`);

        if (opts.json) {
          console.log(JSON.stringify({ history, analysis }, null, 2));
        } else {
          renderTimeline(history, analysis, filePath);
        }
      } catch (err: any) {
        console.error(chalk.red(`\n  Error: ${err.message}`));
        process.exit(1);
      }
    });

  cmd
    .command('top')
    .description('Most churned files in the repo')
    .option('-n, --max <n>', 'Number of files', '15')
    .option('--since <date>', 'Since date')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      const { getTopChurned } = await import('../lib/flux/git.js');
      const { renderTopChurned } = await import('../lib/flux/renderer.js');

      console.log(chalk.bold.cyan('\n  dx flux top') + chalk.dim(` — Churn Analysis\n`));

      try {
        process.stdout.write(chalk.yellow('  ◐ Analyzing repository...'));
        const churned = await getTopChurned(parseInt(opts.max), opts.since);
        process.stdout.write(`\r${chalk.green('  ✓')} ${chalk.bold(churned.length.toString())} files\n\n`);

        if (opts.json) {
          console.log(JSON.stringify(churned, null, 2));
        } else {
          renderTopChurned(churned);
        }
      } catch (err: any) {
        console.error(chalk.red(`\n  Error: ${err.message}`));
        process.exit(1);
      }
    });

  return cmd;
}
