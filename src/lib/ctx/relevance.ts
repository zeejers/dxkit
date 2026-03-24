import { glob } from 'glob';
import { readFileSync } from 'fs';
import { resolve, relative, basename, extname } from 'path';

export interface RelevantFile {
  path: string;
  relativePath: string;
  score: number;
  reasons: string[];
  preview: string; // first few lines
}

export async function findRelevantFiles(query: string, basePath: string, maxFiles: number): Promise<RelevantFile[]> {
  const resolvedBase = resolve(basePath);
  const keywords = extractKeywords(query);

  const files = await glob(
    ['**/*.{ts,tsx,js,jsx,py,go,rs,java,rb,php,vue,svelte}', '!node_modules/**', '!.git/**', '!dist/**', '!build/**', '!coverage/**'],
    { cwd: resolvedBase, absolute: true }
  );

  const scored: RelevantFile[] = [];

  for (const filePath of files) {
    const relativePath = relative(resolvedBase, filePath);
    const fileName = basename(filePath);
    const ext = extname(filePath);
    let content: string;

    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    let score = 0;
    const reasons: string[] = [];

    // Score by keyword matches in filename
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (fileName.toLowerCase().includes(kwLower)) {
        score += 10;
        reasons.push(`filename contains "${kw}"`);
      }
      if (relativePath.toLowerCase().includes(kwLower)) {
        score += 5;
        reasons.push(`path contains "${kw}"`);
      }
    }

    // Score by keyword matches in content
    const contentLower = content.toLowerCase();
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      const occurrences = (contentLower.match(new RegExp(kwLower, 'g')) || []).length;
      if (occurrences > 0) {
        score += Math.min(occurrences * 2, 15);
        reasons.push(`${occurrences}x "${kw}" in content`);
      }
    }

    // Boost entry points and config files
    if (fileName.match(/^(index|main|app|server|cli)\./)) score += 3;
    if (relativePath.includes('route') || relativePath.includes('controller') || relativePath.includes('handler')) score += 2;

    // Penalize test files slightly (they're tracked separately)
    if (fileName.includes('.test.') || fileName.includes('.spec.') || relativePath.includes('__tests__')) {
      score *= 0.5;
    }

    if (score > 0) {
      const lines = content.split('\n').slice(0, 10);
      const preview = lines.join('\n');
      scored.push({ path: filePath, relativePath, score, reasons, preview });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxFiles);
}

function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'need', 'to', 'of', 'in',
    'for', 'on', 'with', 'at', 'by', 'from', 'and', 'or', 'but', 'not',
    'this', 'that', 'these', 'those', 'it', 'its', 'my', 'your', 'our',
    'fix', 'add', 'update', 'change', 'make', 'get', 'set', 'check', 'when',
    'how', 'why', 'what', 'where', 'which', 'who', 'all', 'each', 'every',
  ]);

  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 10);
}
