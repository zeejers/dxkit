import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { DocFile } from './scanner.js';
import { SymbolInfo } from './symbols.js';

export interface AIDriftFinding {
  severity: 'BROKEN' | 'STALE' | 'OUTDATED' | 'MISSING';
  docFile: string;
  line?: number;
  claim: string;
  reality: string;
  suggestion: string;
  confidence: 'high' | 'medium' | 'low';
  sourceFile?: string;
}

interface AIProvider {
  model: any;
  modelId: string;
  name: string;
}

export interface AIOptions {
  maxFiles?: number;
  apiKey?: string;
  model?: string;     // e.g. "claude-opus-4-20250514", "gpt-4o-mini"
  prompt?: string;     // path to custom prompt file
}

// ─── Provider setup ───────────────────────────────────────────

const MODEL_DEFAULTS: Record<string, { provider: 'anthropic' | 'openai'; modelId: string }> = {
  // Anthropic
  'claude-opus-4-20250514': { provider: 'anthropic', modelId: 'claude-opus-4-20250514' },
  'claude-sonnet-4-20250514': { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
  'claude-haiku-4-5-20251001': { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
  // Shortcuts
  'opus': { provider: 'anthropic', modelId: 'claude-opus-4-20250514' },
  'sonnet': { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
  'haiku': { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
  // OpenAI
  'gpt-4o': { provider: 'openai', modelId: 'gpt-4o' },
  'gpt-4o-mini': { provider: 'openai', modelId: 'gpt-4o-mini' },
  'gpt-4.1': { provider: 'openai', modelId: 'gpt-4.1' },
  'o3-mini': { provider: 'openai', modelId: 'o3-mini' },
};

function getProvider(opts: AIOptions): AIProvider {
  // Resolve API key: flag > DXKIT_API_KEY > ANTHROPIC_API_KEY > OPENAI_API_KEY
  const key = opts.apiKey || process.env.DXKIT_API_KEY;

  // If user specified a model, determine the provider from it
  if (opts.model) {
    const known = MODEL_DEFAULTS[opts.model];
    const providerType = known?.provider
      || (opts.model.startsWith('claude') || opts.model.startsWith('claude-') ? 'anthropic' : 'openai');
    const modelId = known?.modelId || opts.model;

    const apiKey = key
      || (providerType === 'anthropic' ? process.env.ANTHROPIC_API_KEY : null)
      || (providerType === 'openai' ? process.env.OPENAI_API_KEY : null);

    if (!apiKey) {
      throw new Error(`No API key for ${providerType}. Set --ai-key, DXKIT_API_KEY, or ${providerType === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}`);
    }

    if (providerType === 'anthropic') {
      const anthropic = createAnthropic({ apiKey });
      return { model: anthropic, modelId, name: 'Anthropic' };
    } else {
      const openai = createOpenAI({ apiKey });
      return { model: openai, modelId, name: 'OpenAI' };
    }
  }

  // Auto-detect from key prefix
  if (key) {
    if (key.startsWith('sk-ant-')) {
      const anthropic = createAnthropic({ apiKey: key });
      return { model: anthropic, modelId: 'claude-sonnet-4-20250514', name: 'Anthropic' };
    }
    if (key.startsWith('sk-')) {
      const openai = createOpenAI({ apiKey: key });
      return { model: openai, modelId: 'gpt-4o', name: 'OpenAI' };
    }
    const anthropic = createAnthropic({ apiKey: key });
    return { model: anthropic, modelId: 'claude-sonnet-4-20250514', name: 'Anthropic' };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return { model: anthropic, modelId: 'claude-sonnet-4-20250514', name: 'Anthropic' };
  }

  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return { model: openai, modelId: 'gpt-4o', name: 'OpenAI' };
  }

  throw new Error(
    'No AI provider configured. Options (in priority order):\n' +
    '  --ai-key sk-ant-...          Flag\n' +
    '  DXKIT_API_KEY=sk-ant-...     dxkit-specific env var\n' +
    '  ANTHROPIC_API_KEY=sk-ant-... Standard env var\n' +
    '  OPENAI_API_KEY=sk-...        Standard env var\n'
  );
}

// ─── Prompt loading ───────────────────────────────────────────

function loadPromptTemplate(customPath?: string): string {
  if (customPath) {
    const resolved = resolve(customPath);
    if (!existsSync(resolved)) {
      throw new Error(`Custom prompt file not found: ${resolved}`);
    }
    return readFileSync(resolved, 'utf-8');
  }

  // Check for .dxkit-prompt.md in cwd (project-level override)
  const projectPrompt = resolve('.dxkit-prompt.md');
  if (existsSync(projectPrompt)) {
    return readFileSync(projectPrompt, 'utf-8');
  }

  // Fall back to built-in default
  return getDefaultPrompt();
}

function getDefaultPrompt(): string {
  // Try to load from the bundled file
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const promptPath = join(__dirname, 'prompts', 'default.md');
    if (existsSync(promptPath)) {
      return readFileSync(promptPath, 'utf-8');
    }
  } catch { /* bundled mode, use inline fallback */ }

  // Inline fallback
  return `You are a documentation drift detector. Your job is to find claims in documentation that don't match the actual source code.

## Documentation File: {{docPath}}

\`\`\`markdown
{{doc}}
\`\`\`

## Source Code Context (exports, functions, constants, types):

{{source}}

## Instructions

Analyze the documentation and compare it against the source code context. Find:

1. **STALE references** — Functions, classes, variables, types mentioned in docs that don't exist in source
2. **OUTDATED claims** — Default values, config options, behavior described in docs that contradicts source
3. **MISSING docs** — Important source exports/features not mentioned in the docs at all
4. **BROKEN references** — File paths, import paths, or URLs in docs that look incorrect

For each finding, respond with a JSON array. Each item:
{
  "severity": "BROKEN" | "STALE" | "OUTDATED" | "MISSING",
  "line": <approximate line number in the doc, or null>,
  "claim": "<what the doc says>",
  "reality": "<what the source code actually shows>",
  "suggestion": "<how to fix it>",
  "confidence": "high" | "medium" | "low",
  "sourceFile": "<relevant source file path, or null>"
}

Rules:
- Only report findings you're confident about. Don't guess.
- If a doc references things that could be in code you can't see, mark it "low" confidence.
- Be specific: quote the exact doc text and the exact source code that contradicts it.
- Focus on factual drift, not style or grammar.
- If the docs are correct, return an empty array: []

Respond ONLY with a valid JSON array, no other text.`;
}

function renderPrompt(template: string, vars: { docPath: string; doc: string; source: string }): string {
  return template
    .replace(/\{\{docPath\}\}/g, vars.docPath)
    .replace(/\{\{doc\}\}/g, vars.doc)
    .replace(/\{\{source\}\}/g, vars.source);
}

// ─── Init: dump default prompt for customization ──────────────

export function initPrompt(): void {
  const outPath = resolve('.dxkit-prompt.md');
  if (existsSync(outPath)) {
    console.log(chalk.yellow(`  ⚠ ${outPath} already exists. Not overwriting.\n`));
    return;
  }

  const template = getDefaultPrompt();
  writeFileSync(outPath, template);
  console.log(chalk.green(`  ✓ Created ${outPath}\n`));
  console.log(chalk.dim('  Edit this file to customize the AI analysis prompt.'));
  console.log(chalk.dim('  Available template variables:'));
  console.log(chalk.dim('    {{docPath}}  — relative path of the doc being analyzed'));
  console.log(chalk.dim('    {{doc}}      — full markdown content of the doc'));
  console.log(chalk.dim('    {{source}}   — exported symbols and key source snippets'));
  console.log(chalk.dim('\n  dxkit will auto-detect .dxkit-prompt.md in your project root.\n'));
}

// ─── Main AI analysis ─────────────────────────────────────────

export async function runAIAnalysis(
  docs: DocFile[],
  symbols: Map<string, SymbolInfo>,
  basePath: string,
  opts: AIOptions,
): Promise<AIDriftFinding[]> {
  const provider = getProvider(opts);
  console.log(chalk.dim(`  Using ${provider.name} (${provider.modelId})`));

  const template = loadPromptTemplate(opts.prompt);
  if (opts.prompt) {
    console.log(chalk.dim(`  Prompt: ${opts.prompt}`));
  } else if (existsSync(resolve('.dxkit-prompt.md'))) {
    console.log(chalk.dim(`  Prompt: .dxkit-prompt.md (project override)`));
  }
  console.log();

  const resolvedBase = resolve(basePath);
  const allFindings: AIDriftFinding[] = [];

  const sourceContext = await buildSourceContext(resolvedBase, symbols);

  const maxFiles = opts.maxFiles || 10;
  const docsToProcess = docs.slice(0, maxFiles);

  for (let i = 0; i < docsToProcess.length; i++) {
    const doc = docsToProcess[i];
    process.stdout.write(`  ${chalk.yellow('◐')} [${i + 1}/${docsToProcess.length}] Analyzing ${chalk.dim(doc.relativePath)}...`);

    try {
      const findings = await analyzeDocWithAI(doc, sourceContext, provider, template);
      allFindings.push(...findings);
      process.stdout.write(`\r  ${chalk.green('✓')} [${i + 1}/${docsToProcess.length}] ${doc.relativePath}: ${chalk.bold(findings.length.toString())} findings\n`);
    } catch (err: any) {
      process.stdout.write(`\r  ${chalk.red('✖')} [${i + 1}/${docsToProcess.length}] ${doc.relativePath}: ${chalk.dim(err.message)}\n`);
    }
  }

  return allFindings;
}

async function analyzeDocWithAI(
  doc: DocFile,
  sourceContext: string,
  provider: AIProvider,
  template: string,
): Promise<AIDriftFinding[]> {
  const prompt = renderPrompt(template, {
    docPath: doc.relativePath,
    doc: doc.content.substring(0, 8000),
    source: sourceContext.substring(0, 12000),
  });

  const { text } = await generateText({
    model: provider.model(provider.modelId),
    prompt,
    maxTokens: 4000,
    temperature: 0,
  });

  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const findings: any[] = JSON.parse(cleaned);

    return findings.map(f => ({
      severity: f.severity || 'STALE',
      docFile: doc.relativePath,
      line: f.line || undefined,
      claim: f.claim || '',
      reality: f.reality || '',
      suggestion: f.suggestion || '',
      confidence: f.confidence || 'medium',
      sourceFile: f.sourceFile || undefined,
    }));
  } catch {
    return [];
  }
}

// ─── Source context builder ───────────────────────────────────

async function buildSourceContext(
  basePath: string,
  symbols: Map<string, SymbolInfo>,
): Promise<string> {
  const lines: string[] = [];

  lines.push('### Exported Symbols\n');
  const byFile = new Map<string, SymbolInfo[]>();
  for (const [, sym] of symbols) {
    if (!sym.exported) continue;
    const arr = byFile.get(sym.relativePath) || [];
    arr.push(sym);
    byFile.set(sym.relativePath, arr);
  }

  for (const [file, syms] of [...byFile.entries()].slice(0, 50)) {
    lines.push(`**${file}**:`);
    for (const sym of syms) {
      lines.push(`  - ${sym.exported ? 'export ' : ''}${sym.type} ${sym.name} (line ${sym.line})`);
    }
  }

  lines.push('\n### Key Source Snippets\n');

  const configFiles = await glob(
    ['**/*.{ts,tsx,js,jsx}'],
    {
      cwd: basePath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/*.d.ts', '**/*.spec.*', '**/*.test.*'],
    }
  );

  for (const filePath of configFiles.slice(0, 100)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relPath = relative(basePath, filePath);

      const interestingLines: string[] = [];
      const fileLines = content.split('\n');
      for (let i = 0; i < fileLines.length; i++) {
        const line = fileLines[i];
        if (
          /(?:export\s+)?(?:const|enum|default|DEFAULT|TIMEOUT|MAX_|MIN_|LIMIT)/i.test(line) ||
          /(?:defaults?|config|options)\s*[:=]/i.test(line) ||
          /(?:registerFilter|addFilter|register(?:Step|Trigger|Handler))/i.test(line)
        ) {
          const snippet = fileLines.slice(i, Math.min(i + 4, fileLines.length)).join('\n');
          interestingLines.push(`  L${i + 1}: ${snippet}`);
          if (interestingLines.length >= 10) break;
        }
      }

      if (interestingLines.length > 0) {
        lines.push(`**${relPath}**:`);
        lines.push(interestingLines.join('\n'));
        lines.push('');
      }
    } catch { /* skip */ }
  }

  return lines.join('\n');
}

// ─── Report renderer ──────────────────────────────────────────

export function renderAIReport(findings: AIDriftFinding[]): void {
  if (findings.length === 0) {
    console.log(chalk.green.bold('\n  ✨ AI analysis found no documentation drift.\n'));
    return;
  }

  console.log();
  console.log(chalk.bold('  ┌──────────────────────────────────────────────────┐'));
  console.log(chalk.bold('  │         AI DRIFT ANALYSIS                        │'));
  console.log(chalk.bold('  └──────────────────────────────────────────────────┘'));
  console.log();

  const counts = { BROKEN: 0, STALE: 0, OUTDATED: 0, MISSING: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  console.log(`  ${chalk.red.bold(`${counts.BROKEN} broken`)}  ${chalk.yellow.bold(`${counts.STALE} stale`)}  ${chalk.magenta.bold(`${counts.OUTDATED} outdated`)}  ${chalk.blue(`${counts.MISSING} missing`)}`);
  console.log();

  const severityOrder = { BROKEN: 0, STALE: 1, OUTDATED: 2, MISSING: 3 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const severityColors: Record<string, (s: string) => string> = {
    BROKEN: chalk.red.bold,
    STALE: chalk.yellow.bold,
    OUTDATED: chalk.magenta.bold,
    MISSING: chalk.blue,
  };
  const severityIcons: Record<string, string> = {
    BROKEN: '✖',
    STALE: '⚠',
    OUTDATED: '⟳',
    MISSING: '◎',
  };
  const confColors: Record<string, (s: string) => string> = {
    high: chalk.green,
    medium: chalk.yellow,
    low: chalk.red,
  };

  for (const f of findings) {
    const sColor = severityColors[f.severity] || chalk.white;
    const icon = severityIcons[f.severity] || '·';
    const cColor = confColors[f.confidence] || chalk.dim;

    console.log(`  ${sColor(`${icon} [${f.severity}]`)} ${cColor(`[${f.confidence}]`)} ${f.docFile}${f.line ? `:${f.line}` : ''}`);
    console.log(chalk.dim(`    Claim:   `) + chalk.red(f.claim));
    console.log(chalk.dim(`    Reality: `) + chalk.green(f.reality));
    console.log(chalk.dim(`    Fix:     `) + f.suggestion);
    if (f.sourceFile) {
      console.log(chalk.dim(`    Source:  ${f.sourceFile}`));
    }
    console.log();
  }

  console.log(chalk.dim('  ─'.repeat(25)));
  console.log(chalk.dim(`  ${findings.length} total findings from AI analysis\n`));
}
