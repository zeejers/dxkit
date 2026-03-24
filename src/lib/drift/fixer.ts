import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { basename, resolve } from 'path';
import { glob } from 'glob';
import { remark } from 'remark';
import { visit } from 'unist-util-visit';
import { createTwoFilesPatch } from 'diff';
import type { Root, InlineCode, Code, Link } from 'mdast';
import { Finding } from './analyzer.js';
import { SymbolInfo } from './symbols.js';

export interface Fix {
  file: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  nodeType: string;
  line: number;
  oldValue: string;
  newValue: string;
}

interface FileEdit {
  file: string;           // absolute path
  relativePath: string;
  original: string;       // original file content
  patched: string;        // content after all fixes applied
  fixes: Fix[];
}

// ─── Main entry ───────────────────────────────────────────────

export async function generateFixes(
  findings: Finding[],
  symbols: Map<string, SymbolInfo>,
  basePath: string,
  apply: boolean,
): Promise<void> {
  const fixable = findings.filter(f =>
    (f.severity === 'BROKEN' || f.severity === 'STALE') && f.docFilePath
  );

  if (fixable.length === 0) {
    console.log(chalk.green('  No fixable issues found.\n'));
    return;
  }

  console.log(chalk.dim(`  Analyzing ${fixable.length} fixable issues...\n`));

  // Pre-compute resolution maps
  const pathResolutions = await buildPathResolutions(fixable, basePath);
  const symbolResolutions = buildSymbolResolutions(fixable, symbols, basePath);
  const allResolutions = new Map([...pathResolutions, ...symbolResolutions]);

  if (allResolutions.size === 0) {
    console.log(chalk.yellow('  Could not auto-resolve any fixes. Issues may need manual review.\n'));
    return;
  }

  // Group findings by doc file, then apply via remark AST
  const byFile = new Map<string, Finding[]>();
  for (const f of fixable) {
    if (!allResolutions.has(findingKey(f))) continue;
    const arr = byFile.get(f.docFilePath) || [];
    arr.push(f);
    byFile.set(f.docFilePath, arr);
  }

  const edits: FileEdit[] = [];

  for (const [filePath, fileFindings] of byFile) {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch { continue; }

    const relativePath = filePath.replace(resolve(basePath) + '/', '');
    const { patched, fixes } = applyFixesViaAST(content, fileFindings, allResolutions);

    if (fixes.length > 0 && patched !== content) {
      edits.push({ file: filePath, relativePath, original: content, patched, fixes });
    }
  }

  if (edits.length === 0) {
    console.log(chalk.yellow('  Fixes resolved but no AST changes produced. Issues may need manual review.\n'));
    return;
  }

  // Stats
  const totalFixes = edits.reduce((s, e) => s + e.fixes.length, 0);
  const high = edits.flatMap(e => e.fixes).filter(f => f.confidence === 'high').length;
  const medium = edits.flatMap(e => e.fixes).filter(f => f.confidence === 'medium').length;
  const low = edits.flatMap(e => e.fixes).filter(f => f.confidence === 'low').length;

  console.log(`  Found ${chalk.bold(totalFixes.toString())} fixes across ${chalk.bold(edits.length.toString())} files`);
  console.log(`  Confidence: ${chalk.green(`${high} high`)}  ${chalk.yellow(`${medium} medium`)}  ${chalk.red(`${low} low`)}\n`);

  // Render unified diffs
  for (const edit of edits) {
    // Show fix summaries
    for (const fix of edit.fixes) {
      const confColor = fix.confidence === 'high' ? chalk.green : fix.confidence === 'medium' ? chalk.yellow : chalk.red;
      console.log(`  ${confColor(`[${fix.confidence}]`)} ${chalk.dim(`${edit.relativePath}:${fix.line}`)} ${fix.reason}`);
      console.log(chalk.dim(`          ${fix.nodeType}: `) + chalk.red(fix.oldValue) + chalk.dim(' → ') + chalk.green(fix.newValue));
      console.log();
    }

    // Unified diff
    const patch = createTwoFilesPatch(
      edit.relativePath,
      edit.relativePath,
      edit.original,
      edit.patched,
      'original',
      'fixed',
      { context: 3 },
    );

    // Colorize diff output
    for (const line of patch.split('\n')) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        console.log(chalk.bold(line));
      } else if (line.startsWith('+')) {
        console.log(chalk.green(line));
      } else if (line.startsWith('-')) {
        console.log(chalk.red(line));
      } else if (line.startsWith('@@')) {
        console.log(chalk.cyan(line));
      } else {
        console.log(chalk.dim(line));
      }
    }
    console.log();
  }

  // Apply or instruct
  if (apply) {
    console.log(chalk.bold.yellow('  Applying fixes...\n'));
    let applied = 0;

    for (const edit of edits) {
      writeFileSync(edit.file, edit.patched);
      console.log(`  ${chalk.green('✓')} ${edit.relativePath} (${edit.fixes.length} fixes)`);
      applied += edit.fixes.length;
    }

    console.log();
    console.log(chalk.green.bold(`  ${applied} fixes applied.`));
    console.log(chalk.dim('  Review changes with: git diff\n'));
  } else {
    console.log(chalk.dim('  ─'.repeat(25)));
    console.log(chalk.bold(`  This is a dry run. To apply:\n`));
    console.log(chalk.bold.cyan(`    drift ${basePath === '.' ? '.' : basePath} --fix --apply\n`));
    console.log(chalk.dim('  Tip: run on a clean git branch so you can review with git diff\n'));
  }
}

// ─── AST-based fix application ────────────────────────────────

interface Resolution {
  oldValue: string;
  newValue: string;
  confidence: Fix['confidence'];
  reason: string;
}

function findingKey(f: Finding): string {
  return `${f.docFilePath}:${f.line}:${f.reference}`;
}

function applyFixesViaAST(
  content: string,
  findings: Finding[],
  resolutions: Map<string, Resolution>,
): { patched: string; fixes: Fix[] } {
  const fixes: Fix[] = [];
  const tree = remark().parse(content);

  // Build a lookup: line -> list of resolutions for that line
  const byLine = new Map<number, { finding: Finding; resolution: Resolution }[]>();
  for (const f of findings) {
    const res = resolutions.get(findingKey(f));
    if (!res || !f.line) continue;
    const arr = byLine.get(f.line) || [];
    arr.push({ finding: f, resolution: res });
    byLine.set(f.line, arr);
  }

  // Walk the AST and apply fixes
  visit(tree, (node) => {
    const line = node.position?.start?.line;
    if (!line) return;

    const entries = byLine.get(line);
    if (!entries) return;

    for (const { finding, resolution } of entries) {
      // Inline code: `myFunc()`, `ClassName`, `src/path.ts`
      if (node.type === 'inlineCode') {
        const ic = node as InlineCode;
        if (ic.value.includes(resolution.oldValue)) {
          const newVal = ic.value.replace(resolution.oldValue, resolution.newValue);
          fixes.push({
            file: finding.docFilePath,
            confidence: resolution.confidence,
            reason: resolution.reason,
            nodeType: 'inlineCode',
            line,
            oldValue: ic.value,
            newValue: newVal,
          });
          ic.value = newVal;
        }
      }

      // Code blocks: ```ts ... ```
      if (node.type === 'code') {
        const code = node as Code;
        if (code.value.includes(resolution.oldValue)) {
          const newVal = code.value.replace(resolution.oldValue, resolution.newValue);
          fixes.push({
            file: finding.docFilePath,
            confidence: resolution.confidence,
            reason: resolution.reason,
            nodeType: 'codeBlock',
            line,
            oldValue: resolution.oldValue,
            newValue: resolution.newValue,
          });
          code.value = newVal;
        }
      }

      // Headings containing inline code: ### `myFunc()`
      if (node.type === 'heading') {
        const heading = node as any;
        for (const child of heading.children || []) {
          if (child.type === 'inlineCode' && child.value.includes(resolution.oldValue)) {
            const newVal = child.value.replace(resolution.oldValue, resolution.newValue);
            fixes.push({
              file: finding.docFilePath,
              confidence: resolution.confidence,
              reason: resolution.reason,
              nodeType: 'heading/inlineCode',
              line,
              oldValue: child.value,
              newValue: newVal,
            });
            child.value = newVal;
          }
        }
      }

      // Plain text references (less common but possible)
      if (node.type === 'text') {
        const text = node as any;
        if (text.value.includes(resolution.oldValue)) {
          const newVal = text.value.replace(resolution.oldValue, resolution.newValue);
          fixes.push({
            file: finding.docFilePath,
            confidence: resolution.confidence,
            reason: resolution.reason,
            nodeType: 'text',
            line,
            oldValue: resolution.oldValue,
            newValue: resolution.newValue,
          });
          text.value = newVal;
        }
      }
    }
  });

  const patched = remark().stringify(tree);
  return { patched, fixes };
}

// ─── Resolution builders ──────────────────────────────────────

async function buildPathResolutions(
  findings: Finding[],
  basePath: string,
): Promise<Map<string, Resolution>> {
  const resolutions = new Map<string, Resolution>();
  const resolvedBase = resolve(basePath);

  // Cache all project files for fuzzy matching
  const allFiles = await glob('**/*.{ts,tsx,js,jsx,mjs}', {
    cwd: resolvedBase,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
  });
  const allRelFiles = allFiles.map(f => f.replace(resolvedBase + '/', ''));

  for (const finding of findings) {
    if (finding.type !== 'broken_path' || !finding.reference) continue;

    const ref = finding.reference;
    const fileName = basename(ref);
    const stem = fileName.replace(/\.(ts|tsx|js|jsx|mjs)$/, '');

    // Strategy 1: Exact basename match
    const exact = allRelFiles.filter(f => basename(f) === fileName);
    if (exact.length === 1) {
      resolutions.set(findingKey(finding), {
        oldValue: ref,
        newValue: exact[0],
        confidence: 'high',
        reason: `Exact basename match for ${fileName}`,
      });
      continue;
    }
    if (exact.length > 1) {
      const best = pickClosestPath(ref, exact);
      if (best) {
        resolutions.set(findingKey(finding), {
          oldValue: ref,
          newValue: best,
          confidence: 'medium',
          reason: `Best of ${exact.length} matches for ${fileName}`,
        });
        continue;
      }
    }

    // Strategy 2: Extension change (e.g. utils.js -> utils.ts)
    const extMatch = allRelFiles.filter(f => {
      const fStem = basename(f).replace(/\.(ts|tsx|js|jsx|mjs)$/, '');
      return fStem === stem;
    });
    if (extMatch.length === 1) {
      resolutions.set(findingKey(finding), {
        oldValue: ref,
        newValue: extMatch[0],
        confidence: 'medium',
        reason: `Extension change: ${fileName} -> ${basename(extMatch[0])}`,
      });
      continue;
    }

    // Strategy 3: Fuzzy name + directory matching
    const refDir = ref.split('/').slice(0, -1).join('/');
    let bestMatch: { path: string; score: number } | null = null;

    for (const relF of allRelFiles) {
      const fStem = basename(relF).replace(/\.(ts|tsx|js|jsx|mjs)$/, '');
      const fDir = relF.split('/').slice(0, -1).join('/');

      const nameSim = similarityScore(stem.toLowerCase(), fStem.toLowerCase());
      const dirSim = refDir && fDir ? similarityScore(refDir.toLowerCase(), fDir.toLowerCase()) : 0;
      const subBonus = (stem.toLowerCase().includes(fStem.toLowerCase()) || fStem.toLowerCase().includes(stem.toLowerCase())) ? 0.3 : 0;
      const score = nameSim * 0.5 + dirSim * 0.2 + subBonus;

      if (score > 0.5 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { path: relF, score };
      }
    }

    if (bestMatch) {
      resolutions.set(findingKey(finding), {
        oldValue: ref,
        newValue: bestMatch.path,
        confidence: bestMatch.score > 0.8 ? 'high' : 'medium',
        reason: `Fuzzy match: ${fileName} -> ${basename(bestMatch.path)} (${Math.round(bestMatch.score * 100)}%)`,
      });
      continue;
    }

    // Strategy 4: Git rename detection
    const gitMatch = findRenamedFileViaGit(ref, resolvedBase);
    if (gitMatch) {
      resolutions.set(findingKey(finding), {
        oldValue: ref,
        newValue: gitMatch,
        confidence: 'medium',
        reason: `Git history: file was moved/renamed`,
      });
    }
  }

  return resolutions;
}

function buildSymbolResolutions(
  findings: Finding[],
  symbols: Map<string, SymbolInfo>,
  basePath: string,
): Map<string, Resolution> {
  const resolutions = new Map<string, Resolution>();
  const resolvedBase = resolve(basePath);

  for (const finding of findings) {
    if (finding.type !== 'dead_reference' || !finding.reference) continue;

    const ref = finding.reference;
    const refLower = ref.toLowerCase();
    const refWords = splitCamelCase(ref);

    let bestMatch: { name: string; score: number } | null = null;

    for (const [name] of symbols) {
      const nameLower = name.toLowerCase();
      const nameWords = splitCamelCase(name);

      const levenSim = similarityScore(refLower, nameLower);
      const subBonus = (refLower.includes(nameLower) || nameLower.includes(refLower)) ? 0.25 : 0;
      const sharedWords = refWords.filter(w => nameWords.some(nw => nw.toLowerCase() === w.toLowerCase()));
      const wordBonus = refWords.length > 0 ? (sharedWords.length / Math.max(refWords.length, nameWords.length)) * 0.3 : 0;
      const score = levenSim * 0.5 + subBonus + wordBonus;

      if (score > 0.4 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { name, score };
      }
    }

    if (bestMatch && bestMatch.score > 0.45) {
      const isFunc = finding.message.includes('Function');
      resolutions.set(findingKey(finding), {
        oldValue: isFunc ? `${ref}()` : ref,
        newValue: isFunc ? `${bestMatch.name}()` : bestMatch.name,
        confidence: bestMatch.score > 0.8 ? 'high' : bestMatch.score > 0.6 ? 'medium' : 'low',
        reason: `Symbol renamed: ${ref} -> ${bestMatch.name} (${Math.round(bestMatch.score * 100)}%)`,
      });
      continue;
    }

    // Git-based rename detection
    const gitRename = findRenamedSymbolViaGit(ref, resolvedBase);
    if (gitRename) {
      const isFunc = finding.message.includes('Function');
      resolutions.set(findingKey(finding), {
        oldValue: isFunc ? `${ref}()` : ref,
        newValue: isFunc ? `${gitRename}()` : gitRename,
        confidence: 'medium',
        reason: `Git history: ${ref} was replaced by ${gitRename}`,
      });
    }
  }

  return resolutions;
}

// ─── Helpers ──────────────────────────────────────────────────

function pickClosestPath(original: string, candidates: string[]): string | null {
  const origParts = original.split('/');
  let best: string | null = null;
  let bestScore = 0;

  for (const c of candidates) {
    const parts = c.split('/');
    let score = 0;
    for (const part of origParts) {
      if (parts.includes(part)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

function findRenamedFileViaGit(filePath: string, cwd: string): string | null {
  try {
    const result = execSync(
      `git log --diff-filter=R --find-renames --name-status --pretty=format: -n 20 2>/dev/null | grep -i "${basename(filePath)}" | head -1`,
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      const parts = result.split('\t');
      if (parts.length >= 3) {
        const newPath = parts[2];
        if (existsSync(resolve(cwd, newPath))) return newPath;
      }
    }
  } catch { /* not a git repo or no results */ }
  return null;
}

function findRenamedSymbolViaGit(symbolName: string, cwd: string): string | null {
  try {
    const result = execSync(
      `git log -1 --pretty=format:"%H" -S "${symbolName}" -- '*.ts' '*.tsx' '*.js' '*.jsx' 2>/dev/null`,
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!result) return null;

    const diff = execSync(
      `git show ${result} --unified=3 -- '*.ts' '*.tsx' '*.js' '*.jsx' 2>/dev/null`,
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const lines = diff.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('-') && lines[i].includes(symbolName)) {
        for (let j = Math.max(0, i - 3); j < Math.min(lines.length, i + 5); j++) {
          if (lines[j].startsWith('+') && !lines[j].startsWith('+++')) {
            const match = lines[j].substring(1).match(
              /(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/
            );
            if (match && match[1] !== symbolName) return match[1];
          }
        }
      }
    }
  } catch { /* not a git repo or no results */ }
  return null;
}

function similarityScore(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const maxLen = Math.max(a.length, b.length);
  const dist = levenshtein(a, b);
  const levenSim = 1 - dist / maxLen;
  const containsSim = a.includes(b) || b.includes(a)
    ? Math.min(a.length, b.length) / maxLen : 0;

  return Math.max(levenSim, containsSim);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function splitCamelCase(str: string): string[] {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(w => w.length > 0);
}
