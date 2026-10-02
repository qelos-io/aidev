import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gitignoreModifyCommand } from '../commands/gitignore';
import { getAidevGitignorePatterns, getMissingGitignorePatterns } from '../commands/init';

describe('gitignore command', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-gi-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('lists the expected patterns', () => {
    const patterns = getAidevGitignorePatterns();
    assert.ok(patterns.includes('.aidev/assets/'));
    assert.ok(patterns.includes('aidev.tasks.json'));
  });

  it('modify adds only missing patterns and keeps existing content', () => {
    const file = path.join(dir, '.gitignore');
    fs.writeFileSync(file, 'node_modules/\n*.log\n');
    assert.ok(getMissingGitignorePatterns(dir).length > 0);
    assert.ok(!getMissingGitignorePatterns(dir).includes('*.log'));

    gitignoreModifyCommand(dir);

    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.startsWith('node_modules/\n*.log\n'));
    assert.deepEqual(getMissingGitignorePatterns(dir), []);
    assert.equal(content.split('\n').filter((l) => l === '*.log').length, 1);

    gitignoreModifyCommand(dir);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  });

  it('modify creates .gitignore when absent', () => {
    gitignoreModifyCommand(dir);
    assert.deepEqual(getMissingGitignorePatterns(dir), []);
  });
});
