import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';

export function harvestCommand(): Command {
  const cmd = new Command('harvest')
    .description('Find duplicate code, inconsistencies, and refactoring opportunities')
    .argument('[path]', 'Directory to scan', '.')
    .option('--min-similarity <n>', 'Minimum similarity (0-100)', '70')
    .option('--language <lang>', 'Filter by language (ts, js, py, go)')
    .option('--report <file>', 'Save markdown report')
    .option('--json', 'JSON output')
    .option('--max-size <n>', 'Max file size in KB', '100')
    .action(async (scanPath: string, opts) => {
      const { scanFiles } = await import('../lib/harvest/scanner.js');
      const { findDuplicates } = await import('../lib/harvest/duplicates.js');
      const { findInconsistencies } = await import('../lib/harvest/inconsistencies.js');
      const { findUnusedExports } = await import('../lib/harvest/unused.js');
      const { renderReport, renderMarkdownReport } = await import('../lib/harvest/renderer.js');

      console.log(chalk.bold.green('\n  dx harvest') + chalk.dim(` — Pattern Harvester\n`));
      console.log(chalk.dim(`  Scanning: ${scanPath}`));
      console.log(chalk.dim(`  Min similarity: ${opts.minSimilarity}%\n`));

      try {
        process.stdout.write(chalk.yellow('  ◐ Scanning source files...'));
        const files = await scanFiles(scanPath, opts.language, parseInt(opts.maxSize));
        process.stdout.write(`\r${chalk.green('  ✓')} ${chalk.bold(files.length.toString())} files\n`);

        if (files.length === 0) {
          console.log(chalk.yellow('\n  No source files found.\n'));
          return;
        }

        process.stdout.write(chalk.yellow('  ◐ Detecting duplicates...'));
        const duplicates = findDuplicates(files, parseInt(opts.minSimilarity));
        process.stdout.write(`\r${chalk.green('  ✓')} ${chalk.bold(duplicates.length.toString())} duplicate groups\n`);

        process.stdout.write(chalk.yellow('  ◐ Finding inconsistencies...'));
        const inconsistencies = findInconsistencies(files);
        process.stdout.write(`\r${chalk.green('  ✓')} ${chalk.bold(inconsistencies.length.toString())} inconsistencies\n`);

        process.stdout.write(chalk.yellow('  ◐ Finding unused exports...'));
        const unused = findUnusedExports(files);
        process.stdout.write(`\r${chalk.green('  ✓')} ${chalk.bold(unused.length.toString())} unused exports\n\n`);

        const results = { duplicates, inconsistencies, unused };

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          renderReport(results, files.length);
        }

        if (opts.report) {
          const md = renderMarkdownReport(results, files.length);
          writeFileSync(opts.report, md);
          console.log(chalk.green(`  ✓ Report saved to ${opts.report}\n`));
        }
      } catch (err: any) {
        console.error(chalk.red(`\n  Error: ${err.message}`));
        process.exit(1);
      }
    });

  return cmd;
}
