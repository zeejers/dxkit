import { SourceFile } from './scanner.js';

export interface Inconsistency {
  type: 'naming' | 'pattern' | 'import-style';
  description: string;
  examples: { file: string; line: number; code: string }[];
  suggestion: string;
}

export function findInconsistencies(files: SourceFile[]): Inconsistency[] {
  const inconsistencies: Inconsistency[] = [];

  // Naming: camelCase vs snake_case
  const camelExports: { file: string; name: string; line: number }[] = [];
  const snakeExports: { file: string; name: string; line: number }[] = [];

  for (const file of files) {
    for (const exp of file.exports) {
      if (exp.name === 'default') continue;
      if (/^[a-z][a-zA-Z0-9]*$/.test(exp.name) && exp.name.includes('_') === false) {
        camelExports.push({ file: file.relativePath, name: exp.name, line: exp.line });
      } else if (/^[a-z][a-z0-9_]*$/.test(exp.name) && exp.name.includes('_')) {
        snakeExports.push({ file: file.relativePath, name: exp.name, line: exp.line });
      }
    }
  }

  if (camelExports.length > 0 && snakeExports.length > 0) {
    const minority = camelExports.length < snakeExports.length ? camelExports : snakeExports;
    const majorityStyle = camelExports.length >= snakeExports.length ? 'camelCase' : 'snake_case';

    inconsistencies.push({
      type: 'naming',
      description: `Mixed naming conventions: ${camelExports.length} camelCase vs ${snakeExports.length} snake_case exports`,
      examples: minority.slice(0, 5).map(e => ({
        file: e.file,
        line: e.line,
        code: e.name,
      })),
      suggestion: `Standardize on ${majorityStyle} (the majority pattern)`,
    });
  }

  // Pattern: multiple error handling approaches
  const errorPatterns = {
    tryCatch: 0,
    thenCatch: 0,
    ifErr: 0,
    files: { tryCatch: [] as string[], thenCatch: [] as string[], ifErr: [] as string[] },
  };

  for (const file of files) {
    const content = file.content;
    if (/try\s*\{[\s\S]*?catch/.test(content)) {
      errorPatterns.tryCatch++;
      errorPatterns.files.tryCatch.push(file.relativePath);
    }
    if (/\.then\([\s\S]*?\.catch\(/.test(content)) {
      errorPatterns.thenCatch++;
      errorPatterns.files.thenCatch.push(file.relativePath);
    }
    if (/if\s*\(\s*err\b/.test(content)) {
      errorPatterns.ifErr++;
      errorPatterns.files.ifErr.push(file.relativePath);
    }
  }

  const activePatterns = Object.entries(errorPatterns)
    .filter(([key, val]) => key !== 'files' && (val as number) > 2)
    .length;

  if (activePatterns >= 2) {
    inconsistencies.push({
      type: 'pattern',
      description: `Multiple error handling patterns: try/catch (${errorPatterns.tryCatch}), .then/.catch (${errorPatterns.thenCatch}), if(err) (${errorPatterns.ifErr})`,
      examples: [
        ...errorPatterns.files.tryCatch.slice(0, 2).map(f => ({ file: f, line: 0, code: 'try { ... } catch (e)' })),
        ...errorPatterns.files.thenCatch.slice(0, 2).map(f => ({ file: f, line: 0, code: '.then(...).catch(...)' })),
      ],
      suggestion: 'Standardize on one error handling approach (async/await with try/catch is recommended)',
    });
  }

  // Import style: default vs named
  let defaultImports = 0;
  let namedImports = 0;
  const defaultImportFiles: string[] = [];
  const namedImportFiles: string[] = [];

  for (const file of files) {
    for (const imp of file.imports) {
      if (imp.from.startsWith('.')) { // Only check local imports
        if (imp.names.length === 1 && !file.content.includes(`{ ${imp.names[0]} }`)) {
          defaultImports++;
          if (!defaultImportFiles.includes(file.relativePath)) defaultImportFiles.push(file.relativePath);
        } else {
          namedImports++;
          if (!namedImportFiles.includes(file.relativePath)) namedImportFiles.push(file.relativePath);
        }
      }
    }
  }

  if (defaultImports > 3 && namedImports > 3) {
    inconsistencies.push({
      type: 'import-style',
      description: `Mixed import styles: ${defaultImports} default imports vs ${namedImports} named imports for local modules`,
      examples: [
        ...defaultImportFiles.slice(0, 2).map(f => ({ file: f, line: 0, code: 'import foo from "./foo"' })),
        ...namedImportFiles.slice(0, 2).map(f => ({ file: f, line: 0, code: 'import { foo } from "./foo"' })),
      ],
      suggestion: 'Prefer named exports/imports for better tree-shaking and refactoring',
    });
  }

  return inconsistencies;
}
