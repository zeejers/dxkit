export type Severity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface Finding {
  severity: Severity;
  pass: string;
  rule: string;
  message: string;
  file: string;
  line?: number;
  code?: string;
  suggestion?: string;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  startLine: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: '+' | '-' | ' ';
  content: string;
  lineNumber: number;
}

export interface Diff {
  files: DiffFile[];
  additions: number;
  deletions: number;
  raw: string;
}
