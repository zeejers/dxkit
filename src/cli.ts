#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { driftCommand } from './commands/drift.js';
import { ctxCommand } from './commands/ctx.js';
import { revCommand } from './commands/rev.js';
import { fluxCommand } from './commands/flux.js';
import { harvestCommand } from './commands/harvest.js';

const VERSION = '1.0.0';

const BANNER = `
  ${chalk.bold.cyan('dxkit')} ${chalk.dim(`v${VERSION}`)}
  ${chalk.dim('Developer experience toolkit for codebases that don\'t lie.')}
`;

const program = new Command();

program
  .name('dx')
  .description('Developer experience toolkit — drift detection, context compilation, code review, git archaeology, and pattern harvesting')
  .version(VERSION)
  .addHelpText('before', BANNER)
  .addHelpText('after', `
${chalk.bold('Commands:')}
  ${chalk.cyan('drift')}     Find documentation that lies — cross-reference docs against code
  ${chalk.cyan('ctx')}       Compile a context briefing before starting any task
  ${chalk.cyan('rev')}       Multi-pass automated code review on a git branch
  ${chalk.cyan('flux')}      Git archaeology — track how any file evolved and why
  ${chalk.cyan('harvest')}   Find duplicate code, inconsistencies, and refactoring opportunities

${chalk.bold('Examples:')}
  ${chalk.dim('$')} dx drift . --docs docs --src libs,apps/api
  ${chalk.dim('$')} dx drift . --ai
  ${chalk.dim('$')} dx ctx "fix the auth bug"
  ${chalk.dim('$')} dx rev main..HEAD --strict
  ${chalk.dim('$')} dx flux src/auth.ts
  ${chalk.dim('$')} dx flux top -n 20
  ${chalk.dim('$')} dx harvest . --min-similarity 80

${chalk.bold('AI features:')}
  ${chalk.dim('Set')} ANTHROPIC_API_KEY ${chalk.dim('or')} OPENAI_API_KEY ${chalk.dim('to enable AI-powered analysis.')}
  ${chalk.dim('$')} dx drift . --ai --ai-max 10

${chalk.bold('Aliases:')}
  ${chalk.dim('Available as')} ${chalk.cyan('dx')} ${chalk.dim('or')} ${chalk.cyan('dxkit')}
`);

program.addCommand(driftCommand());
program.addCommand(ctxCommand());
program.addCommand(revCommand());
program.addCommand(fluxCommand());
program.addCommand(harvestCommand());

// Default: show help if no command given
if (process.argv.length <= 2) {
  program.help();
}

program.parse();
