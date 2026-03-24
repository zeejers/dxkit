import { SourceFile, FunctionBlock } from './scanner.js';

export interface DuplicateGroup {
  similarity: number;
  functions: {
    file: string;
    name: string;
    startLine: number;
    endLine: number;
    body: string;
  }[];
  estimatedLinesSaved: number;
}

export function findDuplicates(files: SourceFile[], minSimilarity: number): DuplicateGroup[] {
  const allFunctions: { func: FunctionBlock; file: string }[] = [];
  for (const file of files) {
    for (const func of file.functions) {
      allFunctions.push({ func, file: file.relativePath });
    }
  }

  // Group by hash for exact duplicates
  const hashGroups = new Map<string, { func: FunctionBlock; file: string }[]>();
  for (const item of allFunctions) {
    const group = hashGroups.get(item.func.hash) || [];
    group.push(item);
    hashGroups.set(item.func.hash, group);
  }

  const groups: DuplicateGroup[] = [];

  // Exact duplicates (same hash)
  for (const [, items] of hashGroups) {
    if (items.length < 2) continue;

    // Skip if all in same file (overloads, etc.)
    const uniqueFiles = new Set(items.map(i => i.file));
    if (uniqueFiles.size < 2 && items.length < 3) continue;

    const bodyLength = items[0].func.body.split('\n').length;
    groups.push({
      similarity: 100,
      functions: items.map(i => ({
        file: i.file,
        name: i.func.name,
        startLine: i.func.startLine,
        endLine: i.func.endLine,
        body: i.func.body,
      })),
      estimatedLinesSaved: bodyLength * (items.length - 1),
    });
  }

  // Near duplicates (token similarity)
  const threshold = minSimilarity / 100;
  const checked = new Set<string>();

  for (let i = 0; i < allFunctions.length; i++) {
    for (let j = i + 1; j < allFunctions.length; j++) {
      const a = allFunctions[i];
      const b = allFunctions[j];

      // Skip if same hash (already found above)
      if (a.func.hash === b.func.hash) continue;

      // Skip if same file same function
      if (a.file === b.file && a.func.name === b.func.name) continue;

      // Skip very small functions
      if (a.func.tokens.length < 10 || b.func.tokens.length < 10) continue;

      // Quick length check
      const lenRatio = Math.min(a.func.tokens.length, b.func.tokens.length) / Math.max(a.func.tokens.length, b.func.tokens.length);
      if (lenRatio < threshold * 0.8) continue;

      const key = [a.func.hash, b.func.hash].sort().join(':');
      if (checked.has(key)) continue;
      checked.add(key);

      const similarity = tokenSimilarity(a.func.tokens, b.func.tokens);
      if (similarity >= threshold) {
        const bodyLength = Math.min(
          a.func.body.split('\n').length,
          b.func.body.split('\n').length
        );

        groups.push({
          similarity: Math.round(similarity * 100),
          functions: [
            { file: a.file, name: a.func.name, startLine: a.func.startLine, endLine: a.func.endLine, body: a.func.body },
            { file: b.file, name: b.func.name, startLine: b.func.startLine, endLine: b.func.endLine, body: b.func.body },
          ],
          estimatedLinesSaved: bodyLength,
        });
      }
    }

    // Limit comparisons to avoid O(n^2) blowup
    if (checked.size > 50000) break;
  }

  groups.sort((a, b) => b.estimatedLinesSaved - a.estimatedLinesSaved);
  return groups;
}

function tokenSimilarity(a: string[], b: string[]): number {
  // Jaccard similarity on bigrams
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();

  for (let i = 0; i < a.length - 1; i++) bigramsA.add(`${a[i]}|${a[i + 1]}`);
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(`${b[i]}|${b[i + 1]}`);

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
