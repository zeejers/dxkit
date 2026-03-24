import { readFileSync } from 'fs';

export interface Warning {
  type: 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'WARN' | 'DEPRECATED';
  message: string;
  file: string;
  line: number;
}

export async function findWarnings(filePaths: string[]): Promise<Warning[]> {
  const warnings: Warning[] = [];
  const patterns: [Warning['type'], RegExp][] = [
    ['TODO', /\/\/\s*TODO:?\s*(.*)/i],
    ['FIXME', /\/\/\s*FIXME:?\s*(.*)/i],
    ['HACK', /\/\/\s*HACK:?\s*(.*)/i],
    ['XXX', /\/\/\s*XXX:?\s*(.*)/i],
    ['WARN', /\/\/\s*WARN(?:ING)?:?\s*(.*)/i],
    ['DEPRECATED', /\/\/\s*@?DEPRECATED:?\s*(.*)/i],
  ];

  for (const filePath of filePaths) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        for (const [type, regex] of patterns) {
          const match = lines[i].match(regex);
          if (match) {
            warnings.push({
              type,
              message: match[1]?.trim() || '(no description)',
              file: filePath,
              line: i + 1,
            });
          }
        }
      }
    } catch { /* skip */ }
  }

  return warnings;
}
