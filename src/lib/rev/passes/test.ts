import { Diff, Finding } from '../types.js';

export function testPass(diff: Diff): Finding[] {
  const findings: Finding[] = [];

  const sourceFiles = diff.files.filter(f =>
    !f.path.includes('.test.') && !f.path.includes('.spec.') && !f.path.includes('__tests__') &&
    (f.path.endsWith('.ts') || f.path.endsWith('.tsx') || f.path.endsWith('.js') || f.path.endsWith('.jsx')) &&
    f.status !== 'deleted'
  );
  const testFiles = diff.files.filter(f =>
    f.path.includes('.test.') || f.path.includes('.spec.') || f.path.includes('__tests__')
  );

  const testPaths = new Set(testFiles.map(f => f.path));

  // Check if modified source files have corresponding test changes
  for (const file of sourceFiles) {
    const baseName = file.path.replace(/\.(ts|tsx|js|jsx)$/, '');
    const hasTestChange = [...testPaths].some(tp =>
      tp.includes(baseName.split('/').pop()!)
    );

    if (!hasTestChange && file.additions > 5) {
      findings.push({
        severity: 'WARNING',
        pass: 'test',
        rule: 'missing-test-update',
        message: `Source file modified (+${file.additions} lines) but no corresponding test changes`,
        file: file.path,
        suggestion: 'Add or update tests to cover the changes',
      });
    }
  }

  // Test debt ratio
  const sourceAdditions = sourceFiles.reduce((sum, f) => sum + f.additions, 0);
  const testAdditions = testFiles.reduce((sum, f) => sum + f.additions, 0);

  if (sourceAdditions > 0 && testAdditions === 0 && sourceFiles.length > 0) {
    findings.push({
      severity: 'WARNING',
      pass: 'test',
      rule: 'no-test-additions',
      message: `${sourceAdditions} lines of source code added/modified but 0 lines of test code`,
      file: '(overall)',
      suggestion: `Test debt ratio: ${sourceAdditions}:${testAdditions}. Consider adding tests.`,
    });
  }

  // Check for skipped tests
  for (const file of testFiles) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== '+') continue;
        if (/\b(?:it|test|describe)\.(?:skip|only)\b/.test(line.content)) {
          const isSkip = line.content.includes('.skip');
          findings.push({
            severity: isSkip ? 'WARNING' : 'INFO',
            pass: 'test',
            rule: isSkip ? 'skipped-test' : 'focused-test',
            message: isSkip ? 'Test skipped — should it be enabled?' : '.only() will skip other tests — remove before merging',
            file: file.path,
            line: line.lineNumber,
            code: line.content.trim(),
            suggestion: isSkip ? 'Remove .skip or add a TODO explaining why' : 'Remove .only before merging',
          });
        }
      }
    }
  }

  return findings;
}
