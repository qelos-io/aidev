import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Interface as ReadlineInterface } from 'node:readline/promises';
import { logger } from '../logger';
import {
  permissionCovers,
  getMissingPermissions,
  readClaudeSettings,
  validateAgentPermissions,
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

// ─── validateAgentPermissions: anthropic-sdk ─────────────────────────────

function spyLogger() {
  return {
    info: mock.method(logger, 'info', () => {}),
    warn: mock.method(logger, 'warn', () => {}),
  };
}

// readline is only used by the Claude flow; anthropic-sdk does not consult it.
const stubRl = {} as ReadlineInterface;

describe('validateAgentPermissions (anthropic-sdk)', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => mock.restoreAll());
  afterEach(() => {
    mock.restoreAll();
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it('warns when no ANTHROPIC_API_KEY is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const spies = spyLogger();

    await validateAgentPermissions(['anthropic-sdk'], stubRl);

    const warnings = spies.warn.mock.calls.map((c) => c.arguments[0]);
    assert.ok(
      warnings.some((m) => m?.includes('ANTHROPIC_API_KEY')),
      `expected an ANTHROPIC_API_KEY warning, got: ${warnings.join(' | ')}`,
    );
  });

  it('logs success info with the token count when SDK and key are present', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-1,sk-2,sk-3';
    const spies = spyLogger();

    await validateAgentPermissions(['anthropic-sdk'], stubRl);

    const infos = spies.info.mock.calls.map((c) => c.arguments[0]);
    const warnings = spies.warn.mock.calls.map((c) => c.arguments[0]);

    // Should not warn about missing key
    assert.ok(!warnings.some((m) => m?.includes('no ANTHROPIC_API_KEY')));
    // Should report token count (3 keys)
    assert.ok(
      infos.some((m) => m?.includes('3 API keys')),
      `expected info mentioning 3 API keys, got: ${infos.join(' | ')}`,
    );
  });

  it('uses singular "key" wording when exactly one token is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-only';
    const spies = spyLogger();

    await validateAgentPermissions(['anthropic-sdk'], stubRl);

    const infos = spies.info.mock.calls.map((c) => c.arguments[0]);
    assert.ok(
      infos.some((m) => m?.includes('1 API key') && !m.includes('1 API keys')),
      `expected singular "1 API key", got: ${infos.join(' | ')}`,
    );
  });
});

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
