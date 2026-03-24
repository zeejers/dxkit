import { Diff, Finding } from '../types.js';

const RULES = [
  {
    rule: 'hardcoded-secret',
    severity: 'CRITICAL' as const,
    patterns: [
      /(?:password|passwd|pwd|secret|token|api_key|apikey|api[-_]?secret)\s*[:=]\s*['"][^'"]{8,}['"]/i,
      /(?:AWS|aws)_(?:SECRET|ACCESS)_KEY\s*[:=]\s*['"][^'"]+['"]/,
      /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/,
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
    ],
    message: 'Possible hardcoded secret or credential',
    suggestion: 'Use environment variables or a secrets manager instead',
  },
  {
    rule: 'sql-injection',
    severity: 'CRITICAL' as const,
    patterns: [
      /(?:query|execute|exec)\s*\(\s*[`'"]\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP).*\$\{/i,
      /(?:query|execute|exec)\s*\(\s*['"].*['"]\s*\+\s*(?:req|request|params|query|body)\./i,
    ],
    message: 'Potential SQL injection — user input concatenated into query',
    suggestion: 'Use parameterized queries or an ORM',
  },
  {
    rule: 'xss-vector',
    severity: 'CRITICAL' as const,
    patterns: [
      /innerHTML\s*=\s*(?!['"]<)/,
      /dangerouslySetInnerHTML/,
      /document\.write\s*\(/,
      /\.html\s*\(\s*(?:req|request|params|query|body)\./,
    ],
    message: 'Potential XSS vector — unsanitized HTML injection',
    suggestion: 'Sanitize input or use textContent instead of innerHTML',
  },
  {
    rule: 'unsafe-eval',
    severity: 'WARNING' as const,
    patterns: [
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /setTimeout\s*\(\s*['"`]/,
      /setInterval\s*\(\s*['"`]/,
    ],
    message: 'Use of eval() or equivalent — potential code injection',
    suggestion: 'Avoid eval(). Use JSON.parse() for data, or a proper parser',
  },
  {
    rule: 'exposed-env',
    severity: 'WARNING' as const,
    patterns: [
      /process\.env\.\w+.*(?:console\.log|res\.(?:json|send)|response\.)/i,
      /console\.log.*process\.env/i,
    ],
    message: 'Environment variable may be exposed in output',
    suggestion: 'Avoid logging or sending env vars to clients',
  },
];

export function securityPass(diff: Diff): Finding[] {
  const findings: Finding[] = [];

  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== '+') continue;

        for (const rule of RULES) {
          for (const pattern of rule.patterns) {
            if (pattern.test(line.content)) {
              findings.push({
                severity: rule.severity,
                pass: 'security',
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
  }

  return findings;
}
