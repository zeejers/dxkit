import { Diff, Finding } from '../types.js';

const RULES = [
  {
    rule: 'empty-catch',
    severity: 'WARNING' as const,
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    message: 'Empty catch block — errors will be silently swallowed',
    suggestion: 'At minimum, log the error. Consider re-throwing or handling gracefully',
  },
  {
    rule: 'magic-number',
    severity: 'INFO' as const,
    pattern: /(?:if|while|for|return|===?|!==?|[<>]=?)\s*\d{3,}/,
    message: 'Magic number detected — consider using a named constant',
    suggestion: 'Extract to a descriptively named constant',
  },
  {
    rule: 'todo-in-pr',
    severity: 'INFO' as const,
    pattern: /\/\/\s*(?:TODO|FIXME|HACK|XXX|TEMP|TEMPORARY)\b/i,
    message: 'TODO/FIXME comment added — should this be resolved before merging?',
    suggestion: 'Create a ticket for follow-up or resolve before merging',
  },
  {
    rule: 'any-type',
    severity: 'INFO' as const,
    pattern: /:\s*any\b/,
    message: 'Using `any` type — bypasses TypeScript type checking',
    suggestion: 'Use a specific type, unknown, or a generic',
  },
  {
    rule: 'ts-ignore',
    severity: 'WARNING' as const,
    pattern: /@ts-(?:ignore|nocheck|expect-error)/,
    message: 'TypeScript error suppression — hides potential issues',
    suggestion: 'Fix the type error instead of suppressing it',
  },
  {
    rule: 'nested-ternary',
    severity: 'INFO' as const,
    pattern: /\?[^:]*\?.*:/,
    message: 'Nested ternary — hard to read',
    suggestion: 'Use if/else or extract to a function',
  },
  {
    rule: 'long-function',
    severity: 'INFO' as const,
    // This is checked at the file/hunk level, not per-line
    pattern: /^$/,
    message: 'Function may be too long',
    suggestion: 'Consider breaking into smaller functions',
  },
];

export function qualityPass(diff: Diff): Finding[] {
  const findings: Finding[] = [];

  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      // Check for long additions (proxy for long functions)
      let consecutiveAdditions = 0;

      for (const line of hunk.lines) {
        if (line.type === '+') {
          consecutiveAdditions++;

          // Check line-level rules (skip the long-function rule)
          for (const rule of RULES) {
            if (rule.rule === 'long-function') continue;
            if (rule.pattern.test(line.content)) {
              findings.push({
                severity: rule.severity,
                pass: 'quality',
                rule: rule.rule,
                message: rule.message,
                file: file.path,
                line: line.lineNumber,
                code: line.content.trim(),
                suggestion: rule.suggestion,
              });
            }
          }
        } else {
          if (consecutiveAdditions > 50) {
            findings.push({
              severity: 'INFO',
              pass: 'quality',
              rule: 'long-addition',
              message: `${consecutiveAdditions} consecutive lines added — consider breaking up`,
              file: file.path,
              line: hunk.startLine,
              suggestion: 'Large additions may indicate a function that should be split',
            });
          }
          consecutiveAdditions = 0;
        }
      }
    }
  }

  return findings;
}
