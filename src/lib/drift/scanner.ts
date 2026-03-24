import { glob } from 'glob';
import { readFileSync } from 'fs';
import { resolve, relative } from 'path';

export interface DocFile {
  path: string;
  relativePath: string;
  content: string;
  references: DocReference[];
}

export interface DocReference {
  type: 'file_path' | 'function' | 'class' | 'variable' | 'code_block' | 'import';
  value: string;
  line: number;
  context: string; // surrounding text
}

export async function scanDocs(basePath: string, docsDir?: string): Promise<DocFile[]> {
  const resolvedBase = resolve(basePath);
  const ignore = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

  // Support comma-separated directories, both relative and absolute:
  //   --docs docs,~/other-repo/docs,/absolute/path/to/docs
  const docsDirs = docsDir ? docsDir.split(',').map(s => s.trim()) : [];
  let allFiles: string[] = [];

  if (docsDirs.length > 0) {
    for (const dir of docsDirs) {
      const isAbsolute = dir.startsWith('/') || dir.startsWith('~');
      const resolvedDir = isAbsolute ? resolve(dir.replace(/^~/, process.env.HOME || '')) : resolve(resolvedBase, dir);
      const found = await glob(['**/*.md', '**/*.mdx'], { cwd: resolvedDir, absolute: true, ignore });
      allFiles.push(...found);
    }
  } else {
    allFiles = await glob(['**/*.md', '**/*.mdx'], { cwd: resolvedBase, absolute: true, ignore });
  }

  return allFiles.map(filePath => {
    const content = readFileSync(filePath, 'utf-8');
    const relativePath = relative(resolvedBase, filePath);
    const references = extractReferences(content);
    return { path: filePath, relativePath, content, references };
  });
}

function extractReferences(content: string): DocReference[] {
  const refs: DocReference[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // File path references: src/foo/bar.ts, ./lib/utils.js, etc.
    const filePathRegex = /(?:^|[\s`"'(])((\.\/|src\/|lib\/|packages\/|app\/)[a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|py|go|rs))/g;
    let match;
    while ((match = filePathRegex.exec(line)) !== null) {
      refs.push({ type: 'file_path', value: match[1], line: lineNum, context: line.trim() });
    }

    // Function references in backticks: `functionName()`, `functionName`
    const funcRegex = /`([a-zA-Z_$][a-zA-Z0-9_$]*)\(\)`/g;
    while ((match = funcRegex.exec(line)) !== null) {
      refs.push({ type: 'function', value: match[1], line: lineNum, context: line.trim() });
    }

    // Class references: `ClassName`
    const classRegex = /`([A-Z][a-zA-Z0-9]+)`/g;
    while ((match = classRegex.exec(line)) !== null) {
      if (!match[1].match(/^(TODO|FIXME|NOTE|README|API|URL|HTTP|JSON|XML|CSS|HTML|SQL|CLI|SDK)$/)) {
        refs.push({ type: 'class', value: match[1], line: lineNum, context: line.trim() });
      }
    }

    // Import statements in code blocks
    const importRegex = /import\s+\{?\s*([^}]+?)\s*\}?\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(line)) !== null) {
      const imports = match[1].split(',').map(s => s.trim());
      for (const imp of imports) {
        refs.push({ type: 'import', value: imp, line: lineNum, context: line.trim() });
      }
    }
  }

  // Code blocks - extract function calls and variable references
  const codeBlockRegex = /```(?:typescript|javascript|ts|js|tsx|jsx)?\n([\s\S]*?)```/g;
  let blockMatch;
  while ((blockMatch = codeBlockRegex.exec(content)) !== null) {
    const blockContent = blockMatch[1];
    const blockStartLine = content.substring(0, blockMatch.index).split('\n').length;

    // Find function calls in code blocks
    const callRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let callMatch;
    while ((callMatch = callRegex.exec(blockContent)) !== null) {
      const name = callMatch[1];
      if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'typeof', 'console', 'require'].includes(name)) {
        refs.push({ type: 'code_block', value: name, line: blockStartLine, context: `code block: ${name}()` });
      }
    }
  }

  return refs;
}
