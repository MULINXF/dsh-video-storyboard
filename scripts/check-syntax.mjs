#!/usr/bin/env node
/** Cross-platform syntax check (Windows cmd has no POSIX for-loop). */
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['src', 'bin', 'scripts'];
let checked = 0;
for (const dir of dirs) {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:js|mjs)$/.test(entry.name)) continue;
    const file = join(ROOT, dir, entry.name);
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
    checked += 1;
  }
}
console.log(`syntax ok: ${checked} files`);
