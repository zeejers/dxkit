import { SourceFile } from './scanner.js';

export interface UnusedExport {
  name: string;
  type: string;
  file: string;
  line: number;
}

export function findUnusedExports(files: SourceFile[]): UnusedExport[] {
  // Build a set of all imported names from all files
  const importedNames = new Set<string>();
  for (const file of files) {
    for (const imp of file.imports) {
      for (const name of imp.names) {
        importedNames.add(name);
      }
    }
    // Also check for dynamic references in content
    const dynamicRefs = file.content.match(/(?:require|import)\s*\(['"]([^'"]+)['"]\)/g);
    if (dynamicRefs) {
      for (const ref of dynamicRefs) {
        importedNames.add(ref);
      }
    }
  }

  // Also track all string references (for re-exports, dynamic usage, etc.)
  const allContent = files.map(f => f.content).join('\n');

  const unused: UnusedExport[] = [];

  for (const file of files) {
    for (const exp of file.exports) {
      if (exp.name === 'default') continue;
      if (exp.type === 'type') continue; // Types are harder to track

      // Check if this export is imported anywhere
      const isImported = importedNames.has(exp.name);

      // Check if referenced in other files' content (broader search)
      const isReferenced = files.some(f =>
        f.path !== file.path && f.content.includes(exp.name)
      );

      // Check if it appears in the combined content more than just its definition
      const regex = new RegExp(`\\b${exp.name}\\b`, 'g');
      const matches = allContent.match(regex);
      const definitionFile = file.content.match(regex);
      const externalRefs = (matches?.length || 0) - (definitionFile?.length || 0);

      if (!isImported && !isReferenced && externalRefs <= 0) {
        unused.push({
          name: exp.name,
          type: exp.type,
          file: file.relativePath,
          line: exp.line,
        });
      }
    }
  }

  return unused;
}
