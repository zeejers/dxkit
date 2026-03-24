import { DocFile, DocReference } from './scanner.js';
import { SymbolInfo } from './symbols.js';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

export type Severity = 'BROKEN' | 'STALE' | 'MISSING' | 'OK';

export interface Finding {
  severity: Severity;
  type: 'dead_reference' | 'missing_docs' | 'broken_path' | 'stale_example' | 'undocumented_export';
  message: string;
  docFile: string;
  docFilePath: string; // absolute path for editing
  line?: number;
  reference?: string;
  suggestion?: string;
}

export function crossReference(docs: DocFile[], symbols: Map<string, SymbolInfo>): Finding[] {
  const findings: Finding[] = [];
  const documentedSymbols = new Set<string>();

  // Check each doc reference against the symbol table
  for (const doc of docs) {
    for (const ref of doc.references) {
      switch (ref.type) {
        case 'file_path': {
          // Check if referenced file exists
          const basePath = dirname(doc.path);
          const candidates = [
            resolve(basePath, ref.value),
            resolve(process.cwd(), ref.value),
          ];
          const exists = candidates.some(p => existsSync(p));
          if (!exists) {
            findings.push({
              severity: 'BROKEN',
              type: 'broken_path',
              message: `Referenced file does not exist: ${ref.value}`,
              docFile: doc.relativePath,
              docFilePath: doc.path,
              line: ref.line,
              reference: ref.value,
              suggestion: `Remove or update the file reference at line ${ref.line}`,
            });
          }
          break;
        }

        case 'function':
        case 'code_block': {
          const sym = symbols.get(ref.value);
          if (sym) {
            documentedSymbols.add(ref.value);
          } else {
            // Could be a built-in or third-party - only flag if it looks like a project symbol
            if (!isLikelyExternal(ref.value)) {
              findings.push({
                severity: 'STALE',
                type: 'dead_reference',
                message: `Function \`${ref.value}()\` referenced in docs but not found in codebase`,
                docFile: doc.relativePath,
                docFilePath: doc.path,
                line: ref.line,
                reference: ref.value,
                suggestion: `This function may have been renamed or removed. Check git log for recent changes.`,
              });
            }
          }
          break;
        }

        case 'class': {
          const sym = symbols.get(ref.value);
          if (sym) {
            documentedSymbols.add(ref.value);
          } else if (!isLikelyExternal(ref.value)) {
            findings.push({
              severity: 'STALE',
              type: 'dead_reference',
              message: `Class \`${ref.value}\` referenced in docs but not found in codebase`,
              docFile: doc.relativePath,
              docFilePath: doc.path,
              line: ref.line,
              reference: ref.value,
              suggestion: `This class may have been renamed or removed.`,
            });
          }
          break;
        }

        case 'import': {
          const sym = symbols.get(ref.value);
          if (sym) {
            documentedSymbols.add(ref.value);
          }
          break;
        }
      }
    }
  }

  // Find exported symbols with no documentation
  for (const [name, sym] of symbols) {
    if (sym.exported && !documentedSymbols.has(name) && !sym.documented) {
      findings.push({
        severity: 'MISSING',
        type: 'undocumented_export',
        message: `Exported ${sym.type} \`${name}\` has no documentation (no JSDoc, not mentioned in any .md file)`,
        docFile: sym.relativePath,
        docFilePath: sym.file,
        line: sym.line,
        reference: name,
        suggestion: `Add JSDoc comment or mention in documentation.`,
      });
    }
  }

  // Sort by severity
  const severityOrder: Record<Severity, number> = { BROKEN: 0, STALE: 1, MISSING: 2, OK: 3 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return findings;
}

function isLikelyExternal(name: string): boolean {
  const externals = new Set([
    'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext',
    'createElement', 'render', 'mount', 'describe', 'it', 'test', 'expect',
    'beforeEach', 'afterEach', 'jest', 'vi', 'mock', 'spy',
    'get', 'post', 'put', 'delete', 'patch', 'fetch', 'axios',
    'Map', 'Set', 'Array', 'Object', 'String', 'Number', 'Boolean',
    'Promise', 'async', 'await', 'setTimeout', 'setInterval',
    'log', 'warn', 'error', 'info', 'debug',
    'parse', 'stringify', 'resolve', 'reject', 'then', 'catch',
    'push', 'pop', 'shift', 'unshift', 'map', 'filter', 'reduce',
    'join', 'split', 'trim', 'replace', 'match', 'includes',
    'Router', 'Express', 'app',
  ]);
  return externals.has(name);
}
