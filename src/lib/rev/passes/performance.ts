import { Diff, Finding } from '../types.js';

const RULES = [
  {
    rule: 'sync-io-in-async',
    severity: 'WARNING' as const,
    pattern: /(?:readFileSync|writeFileSync|execSync|readdirSync|statSync|existsSync)/,
    context: /async\s+function|=>\s*\{/,
    message: 'Synchronous I/O used (consider async alternative)',
    suggestion: 'Use async versions: readFile, writeFile, exec, etc.',
  },
  {
    rule: 'unbounded-array',
    severity: 'WARNING' as const,
    pattern: /\.push\(.*\).*(?:while|for)\s*\(/,
    message: 'Potential unbounded array growth in loop',
    suggestion: 'Add a size limit or use streaming/pagination',
  },
  {
    rule: 'missing-await',
    severity: 'WARNING' as const,
    pattern: /(?:^|\s)(?:fetch|axios\.|got\.|request\(|fs\.promises\.\w+)\s*\([^)]*\)\s*(?:;|$)/,
    message: 'Async call may be missing await',
    suggestion: 'Add await or handle the promise',
  },
  {
    rule: 'n-plus-one',
    severity: 'WARNING' as const,
    pattern: /for\s*\(.*\)\s*\{[^}]*(?:await\s+)?(?:fetch|query|find|get|select|\.findOne|\.findMany)\s*\(/,
    message: 'Potential N+1 query pattern — database/API call inside loop',
    suggestion: 'Batch the queries or use eager loading',
  },
  {
    rule: 'large-bundle-import',
    severity: 'INFO' as const,
    pattern: /import\s+(?:\w+|\{[^}]+\})\s+from\s+['"](?:lodash|moment|date-fns)(?:\/|['"])/,
    message: 'Importing from a large library — may increase bundle size',
    suggestion: 'Use specific imports (e.g., lodash/get instead of lodash)',
  },
  {
    rule: 'console-in-prod',
    severity: 'INFO' as const,
    pattern: /console\.(log|debug|info|warn|error|trace)\s*\(/,
    message: 'Console statement in production code',
    suggestion: 'Use a proper logger or remove before merging',
  },
];

export function performancePass(diff: Diff): Finding[] {
  const findings: Finding[] = [];

  for (const file of diff.files) {
    if (file.path.includes('.test.') || file.path.includes('.spec.') || file.path.includes('__tests__')) continue;

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== '+') continue;

        for (const rule of RULES) {
          if (rule.pattern.test(line.content)) {
            findings.push({
              severity: rule.severity,
              pass: 'performance',
              rule: rule.rule,
              message: rule.message,
              file: file.path,
              line: line.lineNumber,
              code: line.content.trim(),
              suggestion: rule.suggestion,
            });
          }
        }
      }
    }
  }

  return findings;
}
