import { Diff, Finding } from '../types.js';

export function stylePass(diff: Diff): Finding[] {
  const findings: Finding[] = [];

  for (const file of diff.files) {
    if (file.status === 'deleted') continue;

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== '+') continue;
        const content = line.content;

        // Inconsistent quotes
        if (content.includes('"') && content.includes("'") && !content.includes('`')) {
          // Only flag obvious cases
          if (/from\s+"/.test(content) || /require\("/.test(content)) {
            // Check if project uses single quotes elsewhere in diff
            const usesSingle = diff.files.some(f =>
              f.hunks.some(h => h.lines.some(l =>
                l.type === ' ' && (l.content.includes("from '") || l.content.includes("require('"))
              ))
            );
            if (usesSingle) {
              findings.push({
                severity: 'INFO',
                pass: 'style',
                rule: 'inconsistent-quotes',
                message: 'Double quotes used but codebase appears to use single quotes',
                file: file.path,
                line: line.lineNumber,
                code: content.trim(),
                suggestion: 'Match the existing code style for consistency',
              });
            }
          }
        }

        // Trailing whitespace
        if (/\s+$/.test(content) && content.trim().length > 0) {
          findings.push({
            severity: 'INFO',
            pass: 'style',
            rule: 'trailing-whitespace',
            message: 'Trailing whitespace',
            file: file.path,
            line: line.lineNumber,
          });
        }

        // Very long lines (>120 chars)
        if (content.length > 120 && !content.includes('http://') && !content.includes('https://')) {
          findings.push({
            severity: 'INFO',
            pass: 'style',
            rule: 'long-line',
            message: `Line is ${content.length} characters (>120)`,
            file: file.path,
            line: line.lineNumber,
            code: content.trim().substring(0, 80) + '...',
            suggestion: 'Consider breaking into multiple lines',
          });
        }

        // Mixed var/let/const
        if (/\bvar\b/.test(content) && !content.includes('//')) {
          findings.push({
            severity: 'INFO',
            pass: 'style',
            rule: 'var-usage',
            message: 'Using `var` — prefer `const` or `let`',
            file: file.path,
            line: line.lineNumber,
            code: content.trim(),
            suggestion: 'Use const for immutable values, let for mutable ones',
          });
        }
      }
    }
  }

  return findings;
}
