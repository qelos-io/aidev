import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { envVal, renderEnv, ensureGitignore, getWindowsCursorInitMessage, Answers } from '../commands/init';

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
  linearApiKey: '',
  linearTeamId: '',
  linearLabel: '',
  linearPendingStatus: '',
  linearInReviewStatus: '',
  nonCodeTag: '',
  nonCodeClickupTeamId: '',
  nonCodeJiraProject: '',
  nonCodeLinearTeamId: '',
  assigneeTag: '',
  gitRemote: 'origin',
  githubBaseBranch: 'main',
  githubRepo: 'owner/repo',
  agents: 'claude,cursor',
  devNotesMode: 'smart',
  triggerWord: 'aidev-continue',
  thinkingTag: '',
  aidevEnvExtend: '',
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

  it('omits AIDEV_ENV_EXTEND when empty', () => {
    const out = renderEnv({ ...baseAnswers, aidevEnvExtend: '' });
    assert.ok(!out.includes('AIDEV_ENV_EXTEND'));
  });

  it('includes AIDEV_ENV_EXTEND at the top when set', () => {
    const out = renderEnv({ ...baseAnswers, aidevEnvExtend: '/home/user/.aidev.global' });
    assert.ok(out.includes('AIDEV_ENV_EXTEND=/home/user/.aidev.global'));
    // must appear before provider config
    const extIdx = out.indexOf('AIDEV_ENV_EXTEND');
    const provIdx = out.indexOf('PROVIDER=');
    assert.ok(extIdx < provIdx, 'AIDEV_ENV_EXTEND should appear before PROVIDER');
  });

  it('includes a descriptive comment before AIDEV_ENV_EXTEND when set', () => {
    const out = renderEnv({ ...baseAnswers, aidevEnvExtend: '/home/user/.aidev.global' });
    assert.ok(out.includes('# Global env base'));
  });
});

// ─── renderEnv local provider ─────────────────────────────────────────────────

describe('renderEnv local provider', () => {
  it('writes PROVIDER=local with comment about .aidev/tasks', () => {
    const out = renderEnv({ ...baseAnswers, provider: 'local' });
    assert.ok(out.includes('PROVIDER=local'));
    assert.ok(out.includes('.aidev/tasks'));
  });

  it('does not include ClickUp or Jira keys for local provider', () => {
    const out = renderEnv({ ...baseAnswers, provider: 'local' });
    assert.ok(!out.includes('CLICKUP_API_KEY'));
    assert.ok(!out.includes('JIRA_BASE_URL'));
  });

  it('still includes shared config (AGENTS, GIT_REMOTE, etc.)', () => {
    const out = renderEnv({ ...baseAnswers, provider: 'local' });
    assert.ok(out.includes('AGENTS=claude,cursor'));
    assert.ok(out.includes('GIT_REMOTE=origin'));
    assert.ok(out.includes('GITHUB_BASE_BRANCH=main'));
  });
});

// ─── getWindowsCursorInitMessage ──────────────────────────────────────────────

describe('getWindowsCursorInitMessage', () => {
  const winNoAgent = { isWindows: true, commandExists: (_: string) => false };
  const winWithAgent = { isWindows: true, commandExists: (c: string) => c === 'agent' };
  const notWin = { isWindows: false, commandExists: (_: string) => false };

  it('returns null when not Windows', () => {
    assert.equal(getWindowsCursorInitMessage('cursor,claude', notWin), null);
  });

  it('returns null when cursor not in agents list', () => {
    assert.equal(getWindowsCursorInitMessage('claude,windsurf', winNoAgent), null);
  });

  it('returns null when Windows and agent exists', () => {
    assert.equal(getWindowsCursorInitMessage('cursor,claude', winWithAgent), null);
  });

  it('returns message when Windows, cursor in list, and agent missing', () => {
    const msg = getWindowsCursorInitMessage('cursor,claude', winNoAgent);
    assert.ok(msg !== null);
    assert.ok(msg!.includes('Windows: Cursor Agent CLI'));
    assert.ok(msg!.includes('cursor.com/install?win32=true'));
    assert.ok(msg!.includes('iex'));
    assert.ok(msg!.includes('agent --version'));
  });

  it('handles agents string with spaces', () => {
    const msg = getWindowsCursorInitMessage('claude , cursor , windsurf', winNoAgent);
    assert.ok(msg !== null);
    assert.ok(msg!.includes('cursor.com/install'));
  });
});

// ─── existing env round-trip (edit flow) ─────────────────────────────────────
//
// Core guarantee: when the user presses Enter for every prompt during a
// re-edit, the written .env.aidev must be byte-for-byte identical to the
// original.  We verify this by:
//   1. renderEnv(answers) → parse with dotenv → feed parsed values back in →
//      renderEnv again → assert equal.
// This mirrors exactly what initCommand does: it reads the file with
// dotenv.parse() and uses the result as the `defaultVal` for each prompt.

/** Reconstruct an Answers object from a dotenv-parsed record (same logic as initCommand). */
function answersFromParsed(p: Record<string, string>, folderName = 'myproject'): Answers {
  return {
    provider: (p.PROVIDER || 'clickup') as Answers['provider'],
    aidevEnvExtend: p.AIDEV_ENV_EXTEND || '',
    clickupApiKey: p.CLICKUP_API_KEY || '',
    clickupTeamId: p.CLICKUP_TEAM_ID || '',
    clickupTag: p.CLICKUP_TAG || folderName,
    clickupPendingStatus: p.CLICKUP_PENDING_STATUS || 'pending',
    clickupInReviewStatus: p.CLICKUP_IN_REVIEW_STATUS || 'review',
    jiraBaseUrl: p.JIRA_BASE_URL || '',
    jiraEmail: p.JIRA_EMAIL || '',
    jiraApiToken: p.JIRA_API_TOKEN || '',
    jiraProject: p.JIRA_PROJECT || '',
    jiraLabel: p.JIRA_LABEL || folderName,
    jiraPendingStatus: p.JIRA_PENDING_STATUS || 'To Do',
    jiraInReviewStatus: p.JIRA_IN_REVIEW_STATUS || 'In Review',
    linearApiKey: p.LINEAR_API_KEY || '',
    linearTeamId: p.LINEAR_TEAM_ID || '',
    linearLabel: p.LINEAR_LABEL || folderName,
    linearPendingStatus: p.LINEAR_PENDING_STATUS || 'Backlog',
    linearInReviewStatus: p.LINEAR_IN_REVIEW_STATUS || 'In Review',
    nonCodeTag: p.NON_CODE_TAG || '',
    nonCodeClickupTeamId: p.NON_CODE_CLICKUP_TEAM_ID || '',
    nonCodeJiraProject: p.NON_CODE_JIRA_PROJECT || '',
    nonCodeLinearTeamId: p.NON_CODE_LINEAR_TEAM_ID || '',
    assigneeTag: p.ASSIGNEE_TAG || '',
    gitRemote: p.GIT_REMOTE || 'origin',
    githubBaseBranch: p.GITHUB_BASE_BRANCH || 'main',
    githubRepo: p.GITHUB_REPO || '',
    agents: p.AGENTS || '',
    devNotesMode: p.DEV_NOTES_MODE || 'smart',
    triggerWord: p.AIDEV_TRIGGER_WORD || 'aidev-continue',
    thinkingTag: p.THINKING_TAG || '',
  };
}

describe('existing env round-trip (edit flow)', () => {
  it('dotenv.parse recovers all ClickUp field values from rendered output', () => {
    const out = renderEnv(baseAnswers);
    const p = dotenv.parse(out);
    assert.equal(p.PROVIDER, 'clickup');
    assert.equal(p.CLICKUP_API_KEY, 'pk_abc123');
    assert.equal(p.CLICKUP_TEAM_ID, 'team_456');
    assert.equal(p.CLICKUP_TAG, 'myproject');
    assert.equal(p.CLICKUP_PENDING_STATUS, 'pending');
    assert.equal(p.CLICKUP_IN_REVIEW_STATUS, 'review');
    assert.equal(p.GIT_REMOTE, 'origin');
    assert.equal(p.GITHUB_BASE_BRANCH, 'main');
    assert.equal(p.GITHUB_REPO, 'owner/repo');
    assert.equal(p.AGENTS, 'claude,cursor');
    assert.equal(p.DEV_NOTES_MODE, 'smart');
    assert.equal(p.AIDEV_TRIGGER_WORD, 'aidev-continue');
  });

  it('re-rendering ClickUp answers with parsed values produces identical output', () => {
    const first = renderEnv(baseAnswers);
    const second = renderEnv(answersFromParsed(dotenv.parse(first)));
    assert.equal(second, first);
  });

  it('re-rendering Jira answers with parsed values produces identical output', () => {
    const jiraAnswers: Answers = {
      ...baseAnswers,
      provider: 'jira',
      clickupApiKey: '',
      clickupTeamId: '',
      clickupTag: '',
      clickupPendingStatus: '',
      clickupInReviewStatus: '',
      jiraBaseUrl: 'https://acme.atlassian.net',
      jiraEmail: 'dev@acme.com',
      jiraApiToken: 'tok_secret',
      jiraProject: 'PROJ',
      jiraLabel: 'aidev',
      jiraPendingStatus: 'To Do',
      jiraInReviewStatus: 'In Review',
    };
    const first = renderEnv(jiraAnswers);
    const second = renderEnv(answersFromParsed(dotenv.parse(first)));
    assert.equal(second, first);
  });

  it('quoted values (spaces) survive parse → re-render', () => {
    const answers: Answers = {
      ...baseAnswers,
      clickupPendingStatus: 'needs info',
      clickupInReviewStatus: 'in review',
    };
    const first = renderEnv(answers);
    const parsed = dotenv.parse(first);
    // dotenv strips quotes — parsed values should be plain strings
    assert.equal(parsed.CLICKUP_PENDING_STATUS, 'needs info');
    assert.equal(parsed.CLICKUP_IN_REVIEW_STATUS, 'in review');
    const second = renderEnv(answersFromParsed(parsed));
    assert.equal(second, first);
  });

  it('AIDEV_ENV_EXTEND survives parse → re-render', () => {
    const answers: Answers = { ...baseAnswers, aidevEnvExtend: '/home/user/.aidev.global' };
    const first = renderEnv(answers);
    const second = renderEnv(answersFromParsed(dotenv.parse(first)));
    assert.equal(second, first);
  });

  it('assigneeTag survives parse → re-render', () => {
    const answers: Answers = { ...baseAnswers, assigneeTag: 'alice <alice@example.com>' };
    const first = renderEnv(answers);
    const parsed = dotenv.parse(first);
    assert.equal(parsed.ASSIGNEE_TAG, 'alice <alice@example.com>');
    const second = renderEnv(answersFromParsed(parsed));
    assert.equal(second, first);
  });

  it('changing one field during edit leaves all others unchanged', () => {
    const first = renderEnv(baseAnswers);
    const parsed = dotenv.parse(first);
    // Simulate user typing a new value only for CLICKUP_TAG
    const editedAnswers = answersFromParsed(parsed);
    editedAnswers.clickupTag = 'new-tag';
    const second = renderEnv(editedAnswers);

    const p2 = dotenv.parse(second);
    assert.equal(p2.CLICKUP_TAG, 'new-tag');
    // Everything else unchanged
    assert.equal(p2.CLICKUP_API_KEY, parsed.CLICKUP_API_KEY);
    assert.equal(p2.CLICKUP_TEAM_ID, parsed.CLICKUP_TEAM_ID);
    assert.equal(p2.AGENTS, parsed.AGENTS);
    assert.equal(p2.GIT_REMOTE, parsed.GIT_REMOTE);
    assert.equal(p2.GITHUB_BASE_BRANCH, parsed.GITHUB_BASE_BRANCH);
  });

  it('THINKING_TAG survives parse → re-render when set', () => {
    const answers: Answers = { ...baseAnswers, thinkingTag: 'think' };
    const first = renderEnv(answers);
    const parsed = dotenv.parse(first);
    assert.equal(parsed.THINKING_TAG, 'think');
    const second = renderEnv(answersFromParsed(parsed));
    assert.equal(second, first);
  });

  it('empty optional fields are absent from parsed output (no stale keys)', () => {
    const out = renderEnv(baseAnswers); // assigneeTag='', thinkingTag='', aidevEnvExtend='', nonCodeTag=''
    const p = dotenv.parse(out);
    assert.ok(!('ASSIGNEE_TAG' in p), 'ASSIGNEE_TAG should be absent when empty');
    assert.ok(!('AIDEV_ENV_EXTEND' in p), 'AIDEV_ENV_EXTEND should be absent when empty');
    assert.ok(!('THINKING_TAG' in p), 'THINKING_TAG should be absent when empty');
    assert.ok(!('NON_CODE_TAG' in p), 'NON_CODE_TAG should be absent when empty');
    assert.ok(!('NON_CODE_CLICKUP_TEAM_ID' in p), 'NON_CODE_CLICKUP_TEAM_ID should be absent when empty');
    assert.ok(!('NON_CODE_JIRA_PROJECT' in p), 'NON_CODE_JIRA_PROJECT should be absent when empty');
    assert.ok(!('NON_CODE_LINEAR_TEAM_ID' in p), 'NON_CODE_LINEAR_TEAM_ID should be absent when empty');
  });
});

// ─── non-code tag fields ──────────────────────────────────────────────────────

describe('renderEnv non-code fields', () => {
  it('includes NON_CODE_TAG when set', () => {
    const out = renderEnv({ ...baseAnswers, nonCodeTag: 'non-code' });
    assert.ok(out.includes('NON_CODE_TAG=non-code'));
  });

  it('omits NON_CODE_TAG when empty', () => {
    const out = renderEnv(baseAnswers);
    assert.ok(!out.includes('NON_CODE_TAG='));
  });

  it('includes descriptive comment for NON_CODE_TAG', () => {
    const out = renderEnv({ ...baseAnswers, nonCodeTag: 'non-code' });
    assert.ok(out.includes('# NON_CODE_TAG'));
  });

  it('includes NON_CODE_CLICKUP_TEAM_ID when set', () => {
    const out = renderEnv({ ...baseAnswers, nonCodeTag: 'non-code', nonCodeClickupTeamId: '999' });
    assert.ok(out.includes('NON_CODE_CLICKUP_TEAM_ID=999'));
  });

  it('omits NON_CODE_CLICKUP_TEAM_ID when empty', () => {
    const out = renderEnv({ ...baseAnswers, nonCodeTag: 'non-code' });
    assert.ok(!out.includes('NON_CODE_CLICKUP_TEAM_ID'));
  });

  it('includes NON_CODE_JIRA_PROJECT when set', () => {
    const out = renderEnv({ ...baseAnswers, nonCodeTag: 'non-code', nonCodeJiraProject: 'OPS' });
    assert.ok(out.includes('NON_CODE_JIRA_PROJECT=OPS'));
  });

  it('NON_CODE_TAG survives parse → re-render', () => {
    const answers: Answers = { ...baseAnswers, nonCodeTag: 'non-code' };
    const first = renderEnv(answers);
    const parsed = dotenv.parse(first);
    assert.equal(parsed.NON_CODE_TAG, 'non-code');
    const second = renderEnv(answersFromParsed(parsed));
    assert.equal(second, first);
  });

  it('NON_CODE_CLICKUP_TEAM_ID survives parse → re-render', () => {
    const answers: Answers = { ...baseAnswers, nonCodeTag: 'ops', nonCodeClickupTeamId: '777' };
    const first = renderEnv(answers);
    const parsed = dotenv.parse(first);
    assert.equal(parsed.NON_CODE_CLICKUP_TEAM_ID, '777');
    const second = renderEnv(answersFromParsed(parsed));
    assert.equal(second, first);
  });

  it('NON_CODE_JIRA_PROJECT survives parse → re-render', () => {
    const answers: Answers = { ...baseAnswers, nonCodeTag: 'ops', nonCodeJiraProject: 'DEVOPS' };
    const first = renderEnv(answers);
    const parsed = dotenv.parse(first);
    assert.equal(parsed.NON_CODE_JIRA_PROJECT, 'DEVOPS');
    const second = renderEnv(answersFromParsed(parsed));
    assert.equal(second, first);
  });

  it('includes NON_CODE_LINEAR_TEAM_ID when set', () => {
    const out = renderEnv({ ...baseAnswers, provider: 'linear', nonCodeTag: 'non-code', nonCodeLinearTeamId: 'team-uuid' });
    assert.ok(out.includes('NON_CODE_LINEAR_TEAM_ID=team-uuid'));
  });
});

// ─── renderEnv Linear provider ───────────────────────────────────────────────

describe('renderEnv Linear provider', () => {
  it('writes PROVIDER=linear and LINEAR_* keys', () => {
    const out = renderEnv({
      ...baseAnswers,
      provider: 'linear',
      linearApiKey: 'lin_api_xxx',
      linearTeamId: 'team-uuid',
      linearLabel: 'aidev',
      linearPendingStatus: 'Backlog',
      linearInReviewStatus: 'In Review',
    });
    assert.ok(out.includes('PROVIDER=linear'));
    assert.ok(out.includes('LINEAR_API_KEY=lin_api_xxx'));
    assert.ok(out.includes('LINEAR_TEAM_ID=team-uuid'));
    assert.ok(out.includes('LINEAR_LABEL=aidev'));
    assert.ok(out.includes('LINEAR_PENDING_STATUS=Backlog'));
    assert.ok(out.includes('LINEAR_IN_REVIEW_STATUS'));
    assert.ok(out.includes('In Review'));
  });

  it('re-rendering Linear answers with parsed values produces identical output', () => {
    const linearAnswers: Answers = {
      ...baseAnswers,
      provider: 'linear',
      clickupApiKey: '',
      clickupTeamId: '',
      clickupTag: '',
      clickupPendingStatus: '',
      clickupInReviewStatus: '',
      linearApiKey: 'lin_api_xxx',
      linearTeamId: 'team-uuid',
      linearLabel: 'myproject',
      linearPendingStatus: 'Backlog',
      linearInReviewStatus: 'In Review',
    };
    const first = renderEnv(linearAnswers);
    const second = renderEnv(answersFromParsed(dotenv.parse(first)));
    assert.equal(second, first);
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
      assert.ok(content.includes('.aidev/assets/'));
      assert.ok(!content.includes('.aidev/\n'));
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
      assert.ok(content.includes('.aidev/assets/'));
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

  it('replaces the legacy .aidev ignore rule with .aidev/assets/', () => {
    withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, '.gitignore'), '.aidev/\n');
      ensureGitignore(dir);
      const content = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
      assert.ok(content.includes('.aidev/assets/'));
      assert.ok(!content.includes('.aidev/\n'));
    });
  });
});
