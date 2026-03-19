'use strict';

const { spawnSync } = require('node:child_process');
const { globSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = globSync('src/__tests__/**/*.test.ts', { cwd: root }).sort();
if (files.length === 0) {
  console.error('No test files found under src/__tests__');
  process.exit(1);
}
const abs = files.map((f) => path.join(root, f));
const r = spawnSync(process.execPath, ['--require', 'tsx/cjs', '--test', ...abs], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(r.status === null ? 1 : r.status);
