import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { envVal, renderEnv, ensureGitignore, Answers } from '../commands/init';

// ─── envVal ──────────────────────────────────────────────────────────────────

describe('envVal', () => {
  it('returns plain value unchanged', () => {
    assert.equal(envVal('simple'), 'simple');
  });

  it('wraps values containing spaces in double quotes', () => {
    assert.equal(envVal('in review'), '"in review"');
  });

  it('wraps values containing # in double quotes', () => {
    assert.equal(envVal('hello#comment'), '"hello#comment"');
  });

  it('wraps values containing single quotes', () => {
    assert.equal(envVal("it's"), `"it's"`);
  });

  it('escapes existing double quotes inside the value', () => {
    assert.equal(envVal('say "hi"'), '"say \\"hi\\""');
  });

  it('returns empty string unchanged', () => {
    assert.equal(envVal(''), '');
  });
});

// ─── renderEnv ───────────────────────────────────────────────────────────────

const baseAnswers: Answers = {
  provider: 'clickup',
  clickupApiKey: 'pk_abc123',
  clickupTeamId: 'team_456',
  clickupTag: 'myproject',
  clickupPendingStatus: 'pending',
  clickupInReviewStatus: 'review',
  jiraBaseUrl: '',
  jiraEmail: '',
  jiraApiToken: '',
  jiraProject: '',
  jiraLabel: '',
  jiraPendingStatus: '',
  jiraInReviewStatus: '',
  assigneeTag: '',
  gitRemote: 'origin',
  githubBaseBranch: 'main',
  githubRepo: 'owner/repo',
  agents: 'claude,cursor',
  devNotesMode: 'smart',
  triggerWord: 'aidev-continue',
};

describe('renderEnv', () => {
  it('writes non-empty values', () => {
    const out = renderEnv(baseAnswers);
    assert.ok(out.includes('CLICKUP_API_KEY=pk_abc123'));
    assert.ok(out.includes('CLICKUP_TEAM_ID=team_456'));
    assert.ok(out.includes('CLICKUP_TAG=myproject'));
    assert.ok(out.includes('AGENTS=claude,cursor'));
    assert.ok(out.includes('GITHUB_REPO=owner/repo'));
  });

  it('omits empty optional values', () => {
    const out = renderEnv(baseAnswers);
    assert.ok(!out.includes('ASSIGNEE_TAG'));
  });

  it('quotes status values that contain spaces', () => {
    const out = renderEnv({ ...baseAnswers, clickupInReviewStatus: 'in review' });
    assert.ok(out.includes('CLICKUP_IN_REVIEW_STATUS="in review"'));
  });

  it('quotes pending status if it has spaces', () => {
    const out = renderEnv({ ...baseAnswers, clickupPendingStatus: 'needs info' });
    assert.ok(out.includes('CLICKUP_PENDING_STATUS="needs info"'));
  });

  it('includes comment before AGENTS', () => {
    const out = renderEnv(baseAnswers);
    assert.ok(out.includes('# Agents to use'));
  });

  it('omits GITHUB_REPO when empty', () => {
    const out = renderEnv({ ...baseAnswers, githubRepo: '' });
    assert.ok(!out.includes('GITHUB_REPO'));
  });
});

// ─── ensureGitignore ─────────────────────────────────────────────────────────

function withTmpDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('ensureGitignore', () => {
  it('creates .gitignore with required entries when file does not exist', () => {
    withTmpDir((dir) => {
      ensureGitignore(dir);
      const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
      assert.ok(content.includes('.env.*'));
      assert.ok(content.includes('*.log'));
    });
  });

  it('appends missing entries to an existing .gitignore', () => {
    withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
      ensureGitignore(dir);
      const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
      assert.ok(content.includes('node_modules/'));
      assert.ok(content.includes('.env.*'));
      assert.ok(content.includes('*.log'));
    });
  });

  it('does not duplicate .env.* if already present', () => {
    withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, '.gitignore'), '.env.*\n*.log\n');
      ensureGitignore(dir);
      const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
      assert.equal((content.match(/\.env\.\*/g) ?? []).length, 1);
      assert.equal((content.match(/\*\.log/g) ?? []).length, 1);
    });
  });

  it('handles existing file without trailing newline', () => {
    withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, '.gitignore'), 'dist');
      ensureGitignore(dir);
      const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
      assert.ok(content.includes('\n.env.*'));
    });
  });
});
