import { glob } from 'glob';
import { readFileSync } from 'fs';
import { resolve, relative } from 'path';

export interface SymbolInfo {
  name: string;
  type: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum';
  file: string;
  relativePath: string;
  line: number;
  exported: boolean;
  documented: boolean; // has JSDoc
}

export async function buildSymbolTable(basePath: string, srcDir?: string): Promise<Map<string, SymbolInfo>> {
  const resolvedBase = resolve(basePath);
  const ignore = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '*.config.*', '**/*.d.ts'];

  // Support comma-separated directories, both relative and absolute:
  //   --src libs,apps/api/src,~/other-repo/src,/absolute/path/src
  const srcDirs = srcDir ? srcDir.split(',').map(s => s.trim()) : [];
  let allFiles: string[] = [];

  if (srcDirs.length > 0) {
    for (const dir of srcDirs) {
      const isAbsolute = dir.startsWith('/') || dir.startsWith('~');
      const resolvedDir = isAbsolute ? resolve(dir.replace(/^~/, process.env.HOME || '')) : resolve(resolvedBase, dir);
      const found = await glob(['**/*.{ts,tsx,js,jsx}'], { cwd: resolvedDir, absolute: true, ignore });
      allFiles.push(...found);
    }
  } else {
    allFiles = await glob(['**/*.{ts,tsx,js,jsx}'], { cwd: resolvedBase, absolute: true, ignore });
  }

  const symbols = new Map<string, SymbolInfo>();

  for (const filePath of allFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relativePath = relative(resolvedBase, filePath);
      const fileSymbols = extractSymbols(content, filePath, relativePath);
      for (const sym of fileSymbols) {
        symbols.set(sym.name, sym);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return symbols;
}

function extractSymbols(content: string, filePath: string, relativePath: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const prevLine = i > 0 ? lines[i - 1] : '';
    const hasJSDoc = prevLine.trim().endsWith('*/') || (i > 1 && lines.slice(Math.max(0, i - 5), i).some(l => l.includes('/**')));
    const exported = line.includes('export ');

    // export function foo()
    let match = line.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (match) {
      symbols.push({ name: match[1], type: 'function', file: filePath, relativePath, line: lineNum, exported, documented: hasJSDoc });
      continue;
    }

    // export const foo = (...) => or export const foo = function
    match = line.match(/(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?(?:\(|function)/);
    if (match) {
      symbols.push({ name: match[1], type: 'function', file: filePath, relativePath, line: lineNum, exported, documented: hasJSDoc });
      continue;
    }

    // export class Foo
    match = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+([A-Z][a-zA-Z0-9_$]*)/);
    if (match) {
      symbols.push({ name: match[1], type: 'class', file: filePath, relativePath, line: lineNum, exported, documented: hasJSDoc });
      continue;
    }

    // export interface Foo
    match = line.match(/(?:export\s+)?interface\s+([A-Z][a-zA-Z0-9_$]*)/);
    if (match) {
      symbols.push({ name: match[1], type: 'interface', file: filePath, relativePath, line: lineNum, exported, documented: hasJSDoc });
      continue;
    }

    // export type Foo
    match = line.match(/(?:export\s+)?type\s+([A-Z][a-zA-Z0-9_$]*)\s*[=<]/);
    if (match) {
      symbols.push({ name: match[1], type: 'type', file: filePath, relativePath, line: lineNum, exported, documented: hasJSDoc });
      continue;
    }

    // export enum Foo
    match = line.match(/(?:export\s+)?enum\s+([A-Z][a-zA-Z0-9_$]*)/);
    if (match) {
      symbols.push({ name: match[1], type: 'enum', file: filePath, relativePath, line: lineNum, exported, documented: hasJSDoc });
      continue;
    }

    // export const FOO_BAR = (non-function constants)
    match = line.match(/(?:export\s+)(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/);
    if (match && !line.includes('=>') && !line.includes('function')) {
      symbols.push({ name: match[1], type: 'variable', file: filePath, relativePath, line: lineNum, exported, documented: hasJSDoc });
    }
  }

  return symbols;
}
