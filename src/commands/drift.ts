import { Command } from 'commander';
import chalk from 'chalk';

export function driftCommand(): Command {
  const cmd = new Command('drift')
    .description('Find documentation that lies — cross-reference docs against code')
    .argument('[path]', 'Path to scan', '.')
    .option('--docs <dirs>', 'Doc directories, comma-separated (supports absolute paths)')
    .option('--src <dirs>', 'Source directories, comma-separated (supports absolute paths)')
    .option('--fix', 'Show fixable issues with diff previews (dry run)')
    .option('--apply', 'Apply fixes (use with --fix)')
    .option('--ai', 'AI-powered semantic drift detection')
    .option('--ai-key <key>', 'API key (overrides DXKIT_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY)')
    .option('--ai-model <model>', 'AI model (e.g. sonnet, opus, haiku, gpt-4o, gpt-4o-mini)')
    .option('--ai-prompt <file>', 'Custom prompt template file (supports {{doc}}, {{source}}, {{docPath}})')
    .option('--ai-init', 'Dump default prompt to .dxkit-prompt.md for customization')
    .option('--ai-max <n>', 'Max doc files for AI analysis', '10')
    .option('--json', 'JSON output')
    .option('--strict', 'Exit 1 on BROKEN or STALE issues')
    .action(async (scanPath: string, opts) => {
      // Handle --ai-init separately
      if (opts.aiInit) {
        const { initPrompt } = await import('../lib/drift/ai.js');
        console.log(chalk.bold.cyan('\n  dx drift --ai-init\n'));
        initPrompt();
        return;
      }

      const { scanDocs } = await import('../lib/drift/scanner.js');
      const { buildSymbolTable } = await import('../lib/drift/symbols.js');
      const { crossReference } = await import('../lib/drift/analyzer.js');
      const { renderReport } = await import('../lib/drift/renderer.js');
      const { generateFixes } = await import('../lib/drift/fixer.js');

      console.log(chalk.bold.cyan('\n  dx drift') + chalk.dim(` — Documentation Drift Detector\n`));
      if (opts.ai) console.log(chalk.dim(`  Mode: AI-enhanced`));
      console.log(chalk.dim(`  Scanning: ${scanPath}\n`));

      if (opts.apply && !opts.fix) {
        console.error(chalk.red('  --apply requires --fix\n'));
        process.exit(1);
      }

      try {
        process.stdout.write(chalk.yellow('  ◐ Scanning documentation...'));
        const docs = await scanDocs(scanPath, opts.docs);
        process.stdout.write(`\r  ${chalk.green('✓')} Found ${chalk.bold(docs.length.toString())} documentation files\n`);

        process.stdout.write(chalk.yellow('  ◐ Building symbol table...'));
        const symbols = await buildSymbolTable(scanPath, opts.src);
        process.stdout.write(`\r  ${chalk.green('✓')} Found ${chalk.bold(symbols.size.toString())} exported symbols\n`);

        process.stdout.write(chalk.yellow('  ◐ Cross-referencing...'));
        const findings = crossReference(docs, symbols);
        process.stdout.write(`\r  ${chalk.green('✓')} Analysis complete\n\n`);

        if (opts.json && !opts.ai) {
          console.log(JSON.stringify(findings, null, 2));
        } else if (!opts.ai) {
          renderReport(findings, symbols);
        } else {
          const broken = findings.filter(f => f.severity === 'BROKEN').length;
          const stale = findings.filter(f => f.severity === 'STALE').length;
          const missing = findings.filter(f => f.severity === 'MISSING').length;
          console.log(chalk.bold('  Static Analysis:'));
          console.log(`  ${chalk.red(`${broken} broken`)}  ${chalk.yellow(`${stale} stale`)}  ${chalk.blue(`${missing} missing`)}\n`);
        }

        if (opts.ai) {
          const { runAIAnalysis, renderAIReport } = await import('../lib/drift/ai.js');
          console.log(chalk.bold.magenta('  🤖 AI Semantic Analysis\n'));
          const aiFindings = await runAIAnalysis(docs, symbols, scanPath, {
            maxFiles: parseInt(opts.aiMax),
            apiKey: opts.aiKey,
            model: opts.aiModel,
            prompt: opts.aiPrompt,
          });
          if (opts.json) {
            console.log(JSON.stringify({ static: findings, ai: aiFindings }, null, 2));
          } else {
            renderAIReport(aiFindings);
          }
        }

        if (opts.fix) {
          console.log(chalk.bold.yellow('\n  📝 Fix Mode' + (opts.apply ? ' (APPLYING)' : ' (dry run)') + '\n'));
          await generateFixes(findings, symbols, scanPath, !!opts.apply);
        }

        if (opts.strict) {
          const hasCritical = findings.some(f => f.severity === 'BROKEN' || f.severity === 'STALE');
          if (hasCritical) process.exit(1);
        }
      } catch (err: any) {
        console.error(chalk.red(`\n  Error: ${err.message}`));
        process.exit(1);
      }
    });

  return cmd;
}
