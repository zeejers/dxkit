import { glob } from 'glob';
import { readFileSync } from 'fs';
import { resolve, relative, extname } from 'path';

export interface SourceFile {
  path: string;
  relativePath: string;
  content: string;
  language: string;
  functions: FunctionBlock[];
  exports: ExportInfo[];
  imports: ImportInfo[];
}

export interface FunctionBlock {
  name: string;
  startLine: number;
  endLine: number;
  body: string;
  tokens: string[];   // normalized tokens for comparison
  hash: string;        // structural hash
}

export interface ExportInfo {
  name: string;
  type: string;
  line: number;
}

export interface ImportInfo {
  names: string[];
  from: string;
  line: number;
}

const LANG_EXTENSIONS: Record<string, string[]> = {
  ts: ['ts', 'tsx'],
  js: ['js', 'jsx', 'mjs'],
  py: ['py'],
  go: ['go'],
};

export async function scanFiles(basePath: string, language?: string, maxSizeKB = 100): Promise<SourceFile[]> {
  const resolvedBase = resolve(basePath);

  let extensions: string[];
  if (language && LANG_EXTENSIONS[language]) {
    extensions = LANG_EXTENSIONS[language];
  } else {
    extensions = Object.values(LANG_EXTENSIONS).flat();
  }

  const pattern = `**/*.{${extensions.join(',')}}`;
  const filePaths = await glob(pattern, {
    cwd: resolvedBase,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/*.d.ts', '**/*.min.*'],
  });

  const files: SourceFile[] = [];

  for (const filePath of filePaths) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (content.length > maxSizeKB * 1024) continue;

      const relativePath = relative(resolvedBase, filePath);
      const ext = extname(filePath).slice(1);
      const lang = Object.entries(LANG_EXTENSIONS).find(([, exts]) => exts.includes(ext))?.[0] || ext;

      const functions = extractFunctions(content);
      const exports = extractExports(content);
      const imports = extractImports(content);

      files.push({ path: filePath, relativePath, content, language: lang, functions, exports, imports });
    } catch { /* skip */ }
  }

  return files;
}

function extractFunctions(content: string): FunctionBlock[] {
  const functions: FunctionBlock[] = [];
  const lines = content.split('\n');

  // Simple brace-counting function extractor
  const funcPatterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>/,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/,
    /(\w+)\s*\([^)]*\)\s*\{/, // method definitions
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of funcPatterns) {
      const match = lines[i].match(pattern);
      if (!match) continue;

      const name = match[1];
      if (!name || name.length < 2) continue;

      // Find function body using brace counting
      let braceCount = 0;
      let started = false;
      let endLine = i;
      const bodyLines: string[] = [];

      for (let j = i; j < Math.min(i + 200, lines.length); j++) {
        const line = lines[j];
        bodyLines.push(line);

        for (const ch of line) {
          if (ch === '{') { braceCount++; started = true; }
          if (ch === '}') braceCount--;
        }

        if (started && braceCount <= 0) {
          endLine = j;
          break;
        }
      }

      if (bodyLines.length >= 3) { // Minimum 3 lines to be interesting
        const body = bodyLines.join('\n');
        const tokens = tokenize(body);
        const hash = simpleHash(tokens.join('|'));

        functions.push({ name, startLine: i + 1, endLine: endLine + 1, body, tokens, hash });
      }
      break; // Only match first pattern per line
    }
  }

  return functions;
}

function extractExports(content: string): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;

    if ((match = line.match(/export\s+(?:async\s+)?function\s+(\w+)/))) {
      exports.push({ name: match[1], type: 'function', line: i + 1 });
    } else if ((match = line.match(/export\s+(?:const|let|var)\s+(\w+)/))) {
      exports.push({ name: match[1], type: 'variable', line: i + 1 });
    } else if ((match = line.match(/export\s+(?:class|interface|type|enum)\s+(\w+)/))) {
      exports.push({ name: match[1], type: 'type', line: i + 1 });
    } else if ((match = line.match(/export\s+default\s+(?:class|function)?\s*(\w+)?/))) {
      exports.push({ name: match[1] || 'default', type: 'default', line: i + 1 });
    }
  }

  return exports;
}

function extractImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/);
    if (match) {
      const names = match[1]
        ? match[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean)
        : [match[2]];
      imports.push({ names, from: match[3], line: i + 1 });
    }
  }

  return imports;
}

function tokenize(code: string): string[] {
  // Normalize: remove comments, whitespace, string literals, rename variables to $N
  return code
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '"STR"')
    .replace(/\d+\.?\d*/g, 'NUM')
    .split(/[\s;,{}()\[\].]+/)
    .filter(t => t.length > 0);
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
