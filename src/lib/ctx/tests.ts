import { glob } from 'glob';
import { basename, dirname, extname, resolve, relative } from 'path';
import { existsSync } from 'fs';

export interface TestFile {
  testPath: string;
  relativePath: string;
  sourceFile: string;
  exists: boolean;
}

export async function findRelatedTests(filePaths: string[], basePath: string): Promise<TestFile[]> {
  const resolvedBase = resolve(basePath);
  const tests: TestFile[] = [];
  const seen = new Set<string>();

  for (const filePath of filePaths) {
    const dir = dirname(filePath);
    const name = basename(filePath, extname(filePath));
    const ext = extname(filePath);
    const relPath = relative(resolvedBase, filePath);

    // Common test file patterns
    const candidates = [
      `${dir}/${name}.test${ext}`,
      `${dir}/${name}.spec${ext}`,
      `${dir}/__tests__/${name}${ext}`,
      `${dir}/__tests__/${name}.test${ext}`,
      `${dir}/../__tests__/${name}.test${ext}`,
      `${dir}/../test/${name}.test${ext}`,
      `${dir}/../tests/${name}.test${ext}`,
    ];

    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);

      const exists = existsSync(candidate);
      if (exists) {
        tests.push({
          testPath: candidate,
          relativePath: relative(resolvedBase, candidate),
          sourceFile: relPath,
          exists,
        });
      }
    }

    // Also search by glob
    try {
      const testFiles = await glob(
        [`**/${name}.test.*`, `**/${name}.spec.*`, `**/__tests__/${name}.*`],
        { cwd: resolvedBase, absolute: true, ignore: ['node_modules/**'] }
      );
      for (const tf of testFiles) {
        if (!seen.has(tf)) {
          seen.add(tf);
          tests.push({
            testPath: tf,
            relativePath: relative(resolvedBase, tf),
            sourceFile: relPath,
            exists: true,
          });
        }
      }
    } catch { /* skip */ }
  }

  return tests;
}
