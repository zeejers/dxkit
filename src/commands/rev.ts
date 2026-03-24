import { Command } from 'commander';
import chalk from 'chalk';

export function revCommand(): Command {
  const cmd = new Command('rev')
    .description('Multi-pass automated code review on a git branch')
    .argument('[range]', 'Git range to review', 'main..HEAD')
    .option('--json', 'JSON output for CI')
    .option('--strict', 'Exit 1 on WARNING or above')
    .option('--pass <passes>', 'Specific passes (comma-separated)', 'security,performance,quality,test,style')
    .action(async (range: string, opts) => {
      const { getDiff } = await import('../lib/rev/diff.js');
      const { securityPass } = await import('../lib/rev/passes/security.js');
      const { performancePass } = await import('../lib/rev/passes/performance.js');
      const { qualityPass } = await import('../lib/rev/passes/quality.js');
      const { testPass } = await import('../lib/rev/passes/test.js');
      const { stylePass } = await import('../lib/rev/passes/style.js');
      const { renderReport } = await import('../lib/rev/renderer.js');
      const { Finding } = await import('../lib/rev/types.js');

      console.log(chalk.bold.blue('\n  dx rev') + chalk.dim(` — Review Autopilot\n`));
      console.log(chalk.dim(`  Reviewing: ${range}\n`));

      try {
        process.stdout.write(chalk.yellow('  ◐ Getting diff...'));
        const diff = await getDiff(range);
        if (diff.files.length === 0) {
          console.log(`\r${chalk.yellow('  ⚠ No changes found in')} ${chalk.dim(range)}\n`);
          return;
        }
        process.stdout.write(`\r${chalk.green('  ✓')} ${chalk.bold(diff.files.length.toString())} files (${chalk.green(`+${diff.additions}`)} ${chalk.red(`-${diff.deletions}`)})\n`);

        const activePasses = opts.pass.split(',');
        const allFindings: any[] = [];

        const passes = [
          { name: 'security', icon: '🔒', fn: securityPass },
          { name: 'performance', icon: '⚡', fn: performancePass },
          { name: 'quality', icon: '💎', fn: qualityPass },
          { name: 'test', icon: '🧪', fn: testPass },
          { name: 'style', icon: '🎨', fn: stylePass },
        ];

        for (const pass of passes) {
          if (!activePasses.includes(pass.name)) continue;
          process.stdout.write(chalk.yellow(`  ◐ ${pass.icon} ${pass.name}...`));
          const findings = pass.fn(diff);
          allFindings.push(...findings);
          const color = findings.length === 0 ? chalk.green : chalk.yellow;
          process.stdout.write(`\r  ${chalk.green('✓')} ${pass.icon} ${pass.name}: ${color(`${findings.length} findings`)}\n`);
        }

        console.log();

        if (opts.json) {
          console.log(JSON.stringify({ range, files: diff.files.length, additions: diff.additions, deletions: diff.deletions, findings: allFindings }, null, 2));
        } else {
          renderReport(allFindings, diff);
        }

        if (opts.strict) {
          const hasCritical = allFindings.some((f: any) => f.severity === 'CRITICAL' || f.severity === 'WARNING');
          if (hasCritical) process.exit(1);
        }
      } catch (err: any) {
        console.error(chalk.red(`\n  Error: ${err.message}`));
        process.exit(1);
      }
    });

  return cmd;
}
