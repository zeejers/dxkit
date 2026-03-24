#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distEntry = join(root, 'dist', 'cli.js');
const srcEntry = join(root, 'src', 'cli.ts');

if (existsSync(distEntry)) {
  // Production: run the built JS
  await import(distEntry);
} else {
  // Dev: run via tsx
  execFileSync(
    join(root, 'node_modules', '.bin', 'tsx'),
    [srcEntry, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
}
