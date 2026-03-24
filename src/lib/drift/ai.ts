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
  severity: 'BROKEN' | 'STALE' | 'OUTDATED';
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
  mode?: string;       // "dev" or "product"
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
  return `You are a documentation drift detector. You compare documentation against source code to find **provable contradictions**.

## Documentation File: {{docPath}}

\`\`\`markdown
{{doc}}
\`\`\`

## Source Code Context

{{source}}

## What to look for

Find places where the documentation **contradicts** the source code:

1. **STALE** — A function, class, or variable name in the docs that does NOT appear in the exported symbols. Wrong name or renamed.
2. **OUTDATED** — A specific claim (default value, config option, parameter, behavior) directly contradicted by source code you can see.
3. **BROKEN** — A file path or import path that doesn't match any file in the symbol index.

## What NOT to flag

- Do NOT flag something as missing just because you can't see the implementation. The source context is a subset.
- Do NOT flag "no source code visible for X." That is a context limitation, not a finding.
- Do NOT flag documentation style, grammar, or completeness.
- Do NOT flag template syntax like {{ variable }} as code references.
- Do NOT invent findings. If docs look correct, return [].

Respond with a JSON array. Each item:
{ "severity": "BROKEN" | "STALE" | "OUTDATED", "line": <number or null>, "claim": "<exact doc text>", "reality": "<what source shows, cite file/symbol>", "suggestion": "<fix>", "confidence": "high" | "medium" | "low", "sourceFile": "<proof file or null>" }

Every finding MUST cite a source file or symbol. No evidence = no finding.
Return [] if docs are correct.

Respond ONLY with a valid JSON array, no other text.`;
}

function renderPrompt(template: string, vars: { docPath: string; doc: string; source: string; mode: string }): string {
  const modeContext = vars.mode === 'product'
    ? `## Document Type: PRODUCT DOCUMENTATION (customer-facing)

These docs describe features, UI behavior, configuration options, and workflows from a user's perspective.
They will NOT reference internal function names, file paths, or imports directly.
Instead, look for:
- Feature descriptions that contradict what the source code implements
- Default values, limits, or timeouts that don't match constants in source
- Described behavior or config options that the source code doesn't support
- Template variables or filter names mentioned in docs that aren't registered in source
- Described steps/triggers/integrations that have no corresponding implementation
Do NOT flag internal code references as missing — these docs intentionally avoid them.\n\n`
    : '';

  return (modeContext + template)
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

  // Build full symbol index (compact) + per-doc relevant context
  process.stdout.write(chalk.yellow('  ◐ Building source context...'));
  const symbolIndex = buildSymbolIndex(symbols);
  const sourceFiles = await indexSourceFiles(resolvedBase);
  process.stdout.write(`\r  ${chalk.green('✓')} Indexed ${chalk.bold(sourceFiles.size.toString())} source files\n\n`);

  const maxFiles = opts.maxFiles || 10;
  const docsToProcess = docs.slice(0, maxFiles);

  for (let i = 0; i < docsToProcess.length; i++) {
    const doc = docsToProcess[i];
    process.stdout.write(`  ${chalk.yellow('◐')} [${i + 1}/${docsToProcess.length}] Analyzing ${chalk.dim(doc.relativePath)}...`);

    try {
      // Build doc-specific context: full symbol index + relevant source snippets
      const docContext = buildDocSpecificContext(doc, symbolIndex, symbols, sourceFiles);
      const findings = await analyzeDocWithAI(doc, docContext, provider, template, opts.mode || 'dev');
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
  mode: string,
): Promise<AIDriftFinding[]> {
  const prompt = renderPrompt(template, {
    docPath: doc.relativePath,
    doc: doc.content.substring(0, 8000),
    source: sourceContext.substring(0, 20000),
    mode,
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

// Compact symbol index: all exports in a dense format the AI can scan
function buildSymbolIndex(symbols: Map<string, SymbolInfo>): string {
  const byFile = new Map<string, SymbolInfo[]>();
  for (const [, sym] of symbols) {
    if (!sym.exported) continue;
    const arr = byFile.get(sym.relativePath) || [];
    arr.push(sym);
    byFile.set(sym.relativePath, arr);
  }

  const lines: string[] = ['## All Exported Symbols\n'];

  // Compact format: one line per file, comma-separated symbols
  for (const [file, syms] of byFile) {
    const symList = syms.map(s => `${s.type[0]}:${s.name}`).join(', ');
    lines.push(`${file} → ${symList}`);
  }

  return lines.join('\n');
}

interface SourceFileEntry {
  path: string;
  relativePath: string;
  content: string;
}

// Index source files for per-doc relevance matching
async function indexSourceFiles(basePath: string): Promise<Map<string, SourceFileEntry>> {
  const files = await glob(
    ['**/*.{ts,tsx,js,jsx}'],
    {
      cwd: basePath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/*.d.ts', '**/*.spec.*', '**/*.test.*'],
    }
  );

  const index = new Map<string, SourceFileEntry>();
  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (content.length > 100_000) continue; // skip huge generated files
      const relativePath = relative(basePath, filePath);
      index.set(relativePath, { path: filePath, relativePath, content });
    } catch { /* skip */ }
  }

  return index;
}

// Build context specific to a doc: full symbol index + relevant source snippets
function buildDocSpecificContext(
  doc: DocFile,
  symbolIndex: string,
  symbols: Map<string, SymbolInfo>,
  sourceFiles: Map<string, SourceFileEntry>,
): string {
  const lines: string[] = [];

  // Always include the full symbol index (compact, usually 5-15KB)
  lines.push(symbolIndex);
  lines.push('');

  // Extract keywords from the doc to find relevant source files
  const docKeywords = extractDocKeywords(doc.content);

  // Score each source file by relevance to this doc
  const scored: { file: SourceFileEntry; score: number }[] = [];
  for (const [, entry] of sourceFiles) {
    let score = 0;
    const pathLower = entry.relativePath.toLowerCase();
    const contentLower = entry.content.toLowerCase();

    for (const kw of docKeywords) {
      const kwLower = kw.toLowerCase();
      // Path match is strong signal
      if (pathLower.includes(kwLower)) score += 10;
      // Content match
      const matches = contentLower.split(kwLower).length - 1;
      if (matches > 0) score += Math.min(matches, 5);
    }

    if (score > 0) scored.push({ file: entry, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // Include top relevant source files (snippets of exports, defaults, config)
  const topFiles = scored.slice(0, 20);
  if (topFiles.length > 0) {
    lines.push('## Relevant Source Code (matched to this doc)\n');

    for (const { file, score } of topFiles) {
      const snippets = extractRelevantSnippets(file.content, docKeywords);
      if (snippets.length > 0) {
        lines.push(`### ${file.relativePath} (relevance: ${score})\n`);
        lines.push('```');
        lines.push(snippets.join('\n---\n'));
        lines.push('```\n');
      }
    }
  }

  return lines.join('\n');
}

function extractDocKeywords(content: string): string[] {
  const keywords = new Set<string>();

  // Extract backticked references
  const backticked = content.match(/`([a-zA-Z_$][\w.$-]*(?:\(\))?)`/g) || [];
  for (const bt of backticked) {
    const clean = bt.replace(/`/g, '').replace(/\(\)$/, '');
    if (clean.length > 2) keywords.add(clean);
  }

  // Extract heading words (likely feature names)
  const headings = content.match(/^#{1,3}\s+(.+)$/gm) || [];
  for (const h of headings) {
    const words = h.replace(/^#+\s+/, '').split(/[\s,/]+/);
    for (const w of words) {
      if (w.length > 3 && !/^(the|and|for|with|how|what|your|this|that|from|into|when|about|using)$/i.test(w)) {
        keywords.add(w);
      }
    }
  }

  // Extract template variable references like {{ $util.uuid }}, {{ initial.webhook }}
  const templateVars = content.match(/\{\{\s*([\w.$]+)\s*\}\}/g) || [];
  for (const tv of templateVars) {
    const parts = tv.replace(/[{}]/g, '').trim().split('.');
    for (const p of parts) {
      if (p.length > 2 && !p.startsWith('$')) keywords.add(p);
    }
  }

  return [...keywords].slice(0, 30);
}

function extractRelevantSnippets(content: string, keywords: string[]): string[] {
  const lines = content.split('\n');
  const snippets: string[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (seen.has(i)) continue;
    const line = lines[i];

    // Check if this line is relevant (export, default, config, or keyword match)
    const isExport = /^export\s/.test(line);
    const isConfig = /(?:default|DEFAULT|config|const\s+\w+\s*=)/i.test(line);
    const hasKeyword = keywords.some(kw => line.toLowerCase().includes(kw.toLowerCase()));

    if (isExport || isConfig || hasKeyword) {
      // Grab a window of context
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 5);
      const snippet = lines.slice(start, end).map((l, idx) => `L${start + idx + 1}: ${l}`).join('\n');
      snippets.push(snippet);
      for (let j = start; j < end; j++) seen.add(j);

      if (snippets.length >= 15) break; // cap per file
    }
  }

  return snippets;
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

  const counts = { BROKEN: 0, STALE: 0, OUTDATED: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  console.log(`  ${chalk.red.bold(`${counts.BROKEN} broken`)}  ${chalk.yellow.bold(`${counts.STALE} stale`)}  ${chalk.magenta.bold(`${counts.OUTDATED} outdated`)}`);
  console.log();

  const severityOrder: Record<string, number> = { BROKEN: 0, STALE: 1, OUTDATED: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const severityColors: Record<string, (s: string) => string> = {
    BROKEN: chalk.red.bold,
    STALE: chalk.yellow.bold,
    OUTDATED: chalk.magenta.bold,
  };
  const severityIcons: Record<string, string> = {
    BROKEN: '✖',
    STALE: '⚠',
    OUTDATED: '⟳',
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
