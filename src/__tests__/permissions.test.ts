import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  permissionCovers,
  getMissingPermissions,
  readClaudeSettings,
} from '../permissions';

// ─── permissionCovers ─────────────────────────────────────────────────────

describe('permissionCovers', () => {
  it('exact match returns true', () => {
    assert.equal(permissionCovers('Bash(git:*)', 'Bash(git:*)'), true);
  });

  it('broader command covers narrower one', () => {
    assert.equal(permissionCovers('Bash(npm:*)', 'Bash(npm install:*)'), true);
    assert.equal(permissionCovers('Bash(npm:*)', 'Bash(npm run:*)'), true);
    assert.equal(permissionCovers('Bash(npm:*)', 'Bash(npm test:*)'), true);
  });

  it('narrower command does not cover broader one', () => {
    assert.equal(permissionCovers('Bash(npm install:*)', 'Bash(npm:*)'), false);
  });

  it('wildcard * covers everything', () => {
    assert.equal(permissionCovers('Bash(*)', 'Bash(git:*)'), true);
    assert.equal(permissionCovers('Bash(*)', 'Bash(npm:*)'), true);
  });

  it('different tools do not cover each other', () => {
    assert.equal(permissionCovers('Read', 'Write'), false);
    assert.equal(permissionCovers('Bash(git:*)', 'Edit'), false);
  });

  it('different tool types return false', () => {
    assert.equal(permissionCovers('Bash(git:*)', 'Bash(npm:*)'), false);
  });

  it('similar prefix without word boundary returns false', () => {
    assert.equal(permissionCovers('Bash(npm:*)', 'Bash(npx:*)'), false);
  });

  it('simple tool names match exactly', () => {
    assert.equal(permissionCovers('Read', 'Read'), true);
    assert.equal(permissionCovers('Write', 'Write'), true);
  });
});

// ─── getMissingPermissions ────────────────────────────────────────────────

describe('getMissingPermissions', () => {
  it('returns all when nothing is allowed', () => {
    const required = ['Bash(git:*)', 'Bash(npm:*)'];
    const missing = getMissingPermissions(required, []);
    assert.deepEqual(missing, required);
  });

  it('returns empty when all are covered', () => {
    const required = ['Bash(git:*)', 'Bash(npm:*)'];
    const missing = getMissingPermissions(required, ['Bash(git:*)', 'Bash(npm:*)']);
    assert.deepEqual(missing, []);
  });

  it('returns only the missing ones', () => {
    const required = ['Bash(git:*)', 'Bash(npm:*)', 'Bash(node:*)'];
    const missing = getMissingPermissions(required, ['Bash(git:*)', 'Bash(node:*)']);
    assert.deepEqual(missing, ['Bash(npm:*)']);
  });

  it('recognises broader existing permissions', () => {
    const required = ['Bash(npm install:*)', 'Bash(npm run:*)'];
    const missing = getMissingPermissions(required, ['Bash(npm:*)']);
    assert.deepEqual(missing, []);
  });

  it('does not accept narrower existing as coverage for broader required', () => {
    const required = ['Bash(npm:*)'];
    const missing = getMissingPermissions(required, ['Bash(npm install:*)', 'Bash(npm run:*)']);
    assert.deepEqual(missing, ['Bash(npm:*)']);
  });
});

// ─── readClaudeSettings ──────────────────────────────────────────────────

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-perm-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('readClaudeSettings', () => {
  it('returns empty when no settings files exist', () => {
    withTmpDir((dir) => {
      const settings = readClaudeSettings(dir);
      assert.deepEqual(settings, {});
    });
  });

  it('reads from .claude/settings.local.json', () => {
    withTmpDir((dir) => {
      const claudeDir = path.join(dir, '.claude');
      fs.mkdirSync(claudeDir);
      fs.writeFileSync(
        path.join(claudeDir, 'settings.local.json'),
        JSON.stringify({ permissions: { allow: ['Bash(git:*)'] } }),
        'utf8'
      );
      const settings = readClaudeSettings(dir);
      assert.deepEqual(settings.permissions?.allow, ['Bash(git:*)']);
    });
  });

  it('merges project and local settings', () => {
    withTmpDir((dir) => {
      const claudeDir = path.join(dir, '.claude');
      fs.mkdirSync(claudeDir);
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Bash(git:*)'] } }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(claudeDir, 'settings.local.json'),
        JSON.stringify({ permissions: { allow: ['Bash(npm:*)'] } }),
        'utf8'
      );
      const settings = readClaudeSettings(dir);
      assert.deepEqual(settings.permissions?.allow, ['Bash(git:*)', 'Bash(npm:*)']);
    });
  });

  it('handles malformed JSON gracefully', () => {
    withTmpDir((dir) => {
      const claudeDir = path.join(dir, '.claude');
      fs.mkdirSync(claudeDir);
      fs.writeFileSync(path.join(claudeDir, 'settings.local.json'), '{bad json', 'utf8');
      const settings = readClaudeSettings(dir);
      assert.deepEqual(settings, {});
    });
  });
});
