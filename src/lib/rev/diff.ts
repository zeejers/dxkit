import { execSync } from 'child_process';
import { Diff, DiffFile, DiffHunk, DiffLine } from './types.js';

export async function getDiff(range: string): Promise<Diff> {
  const raw = execSync(`git diff ${range}`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

  const files: DiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  // Parse unified diff
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split('\n');

    // Extract filename
    const headerMatch = lines[0]?.match(/a\/(.*?) b\/(.*)/);
    if (!headerMatch) continue;

    const path = headerMatch[2];
    let status: DiffFile['status'] = 'modified';
    if (section.includes('new file mode')) status = 'added';
    else if (section.includes('deleted file mode')) status = 'deleted';
    else if (section.includes('rename from')) status = 'renamed';

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let lineNumber = 0;
    let fileAdditions = 0;
    let fileDeletions = 0;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentHunk = { startLine: parseInt(hunkMatch[1]), lines: [] };
        hunks.push(currentHunk);
        lineNumber = parseInt(hunkMatch[1]);
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.lines.push({ type: '+', content: line.substring(1), lineNumber });
        lineNumber++;
        fileAdditions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.lines.push({ type: '-', content: line.substring(1), lineNumber });
        fileDeletions++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: ' ', content: line.substring(1), lineNumber });
        lineNumber++;
      }
    }

    totalAdditions += fileAdditions;
    totalDeletions += fileDeletions;

    files.push({ path, status, additions: fileAdditions, deletions: fileDeletions, hunks });
  }

  return { files, additions: totalAdditions, deletions: totalDeletions, raw };
}
