import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isSecretKey,
  isSecretValue,
  collectSecrets,
  findSecretsInText,
  redactText,
  writeSecretsFile,
  sanitizeTaskForSafeMode,
  secretsFileRelPath,
  secretsFilePath,
} from '../safeMode';

describe('isSecretKey', () => {
  it('matches common secret key names', () => {
    assert.equal(isSecretKey('CLICKUP_API_KEY'), true);
    assert.equal(isSecretKey('JIRA_API_TOKEN'), true);
    assert.equal(isSecretKey('MY_PASSWORD'), true);
    assert.equal(isSecretKey('ANTHROPIC_API_KEY'), true);
  });

  it('does not match unrelated keys', () => {
    assert.equal(isSecretKey('GITHUB_REPO'), false);
    assert.equal(isSecretKey('CLICKUP_TAG'), false);
    assert.equal(isSecretKey('DEV_NOTES_MODE'), false);
  });
});

describe('isSecretValue', () => {
  it('rejects short or non-secret values', () => {
    assert.equal(isSecretValue('CLICKUP_API_KEY', 'short'), false);
    assert.equal(isSecretValue('CLICKUP_TAG', 'myproject'), false);
    assert.equal(isSecretValue('FLAG', 'true'), false);
  });

  it('accepts secret-looking values for secret keys', () => {
    assert.equal(isSecretValue('CLICKUP_API_KEY', 'pk_live_abcdefghij'), true);
  });

  it('skips bare base URLs', () => {
    assert.equal(isSecretValue('JIRA_BASE_URL', 'https://example.atlassian.net'), false);
  });
});

describe('collectSecrets', () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-safe-mode-'));
    for (const key of ['CLICKUP_API_KEY', 'JIRA_API_TOKEN']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('collects secrets from .env.aidev', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.aidev'),
      'CLICKUP_API_KEY=pk_test_secret_value\nCLICKUP_TAG=myproject\n',
      'utf8'
    );
    const secrets = collectSecrets(tmpDir);
    assert.equal(secrets.get('CLICKUP_API_KEY'), 'pk_test_secret_value');
    assert.equal(secrets.has('CLICKUP_TAG'), false);
  });

  it('collects secrets from .env', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'JIRA_API_TOKEN=atlassian_token_value\n',
      'utf8'
    );
    const secrets = collectSecrets(tmpDir);
    assert.equal(secrets.get('JIRA_API_TOKEN'), 'atlassian_token_value');
  });

  it('collects secrets from AIDEV_ENV_EXTEND', () => {
    const extendPath = path.join(tmpDir, 'global.env');
    fs.writeFileSync(extendPath, 'LINEAR_API_KEY=lin_api_abcdefghij\n', 'utf8');
    fs.writeFileSync(
      path.join(tmpDir, '.env.aidev'),
      `AIDEV_ENV_EXTEND=${extendPath}\n`,
      'utf8'
    );
    const secrets = collectSecrets(tmpDir);
    assert.equal(secrets.get('LINEAR_API_KEY'), 'lin_api_abcdefghij');
  });

  it('includes process.env secrets not already collected from files', () => {
    process.env.JIRA_API_TOKEN = 'shell_token_abcdefghij';
    const secrets = collectSecrets(tmpDir);
    assert.equal(secrets.get('JIRA_API_TOKEN'), 'shell_token_abcdefghij');
  });
});

describe('redactText and writeSecretsFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-safe-mode-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replaces secret values with encrypted-content placeholders', () => {
    const found = new Map([['CLICKUP_API_KEY', 'pk_live_secret123']]);
    const text = 'Use API key pk_live_secret123 in the request header.';
    const redacted = redactText(text, found, 'task-1');
    assert.ok(!redacted.includes('pk_live_secret123'));
    assert.ok(redacted.includes('[encrypted content at file'));
    assert.ok(redacted.includes(secretsFileRelPath('task-1')));
    assert.ok(redacted.includes('CLICKUP_API_KEY'));
  });

  it('writes secrets under .aidev/assets/secrets/', () => {
    const found = new Map([
      ['CLICKUP_API_KEY', 'pk_live_secret123'],
      ['JIRA_API_TOKEN', 'atlassian_token_value'],
    ]);
    const rel = writeSecretsFile(found, 'abc123', tmpDir);
    assert.equal(rel, secretsFileRelPath('abc123'));
    const filePath = secretsFilePath('abc123', tmpDir);
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('CLICKUP_API_KEY=pk_live_secret123'));
    assert.ok(content.includes('JIRA_API_TOKEN=atlassian_token_value'));
    assert.ok(content.includes('Prefer terminal pipes'));
  });
});

describe('sanitizeTaskForSafeMode', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-safe-mode-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns unchanged task when no secrets match', () => {
    const task = { id: '1', description: 'Implement login page' };
    const context = 'No secrets here.';
    const result = sanitizeTaskForSafeMode(task, context, new Map(), tmpDir);
    assert.deepEqual(result.task, task);
    assert.equal(result.context, context);
  });

  it('redacts description and context and appends safe-mode notice', () => {
    const secret = 'pk_live_secret123456';
    const task = { id: '99', description: `Configure with ${secret}` };
    const context = `Comment mentions ${secret} again.`;
    const secrets = new Map([['CLICKUP_API_KEY', secret]]);
    const result = sanitizeTaskForSafeMode(task, context, secrets, tmpDir);

    assert.ok(!result.task.description.includes(secret));
    assert.ok(!result.context.includes(secret));
    assert.ok(result.context.includes('Secret values were redacted'));
    assert.ok(fs.existsSync(secretsFilePath('99', tmpDir)));
  });
});
