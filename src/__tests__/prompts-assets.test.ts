import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildAssetsAccessInstructions, buildSavedDiffNotice } from '../prompts/assets';
import { secretsFileRelPath } from '../safeMode';

describe('buildAssetsAccessInstructions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-prompts-assets-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty string when no attachments or secrets exist', () => {
    assert.equal(buildAssetsAccessInstructions('task-1', tmpDir), '');
  });

  it('lists attachment paths and allows reading and copying into the repo', () => {
    const taskId = 'task-42';
    const taskDir = path.join(tmpDir, '.aidev', 'assets', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'logo.png'), 'png', 'utf8');

    const section = buildAssetsAccessInstructions(taskId, tmpDir);

    assert.ok(section.includes('## Aidev task assets'));
    assert.ok(section.includes('`.aidev/assets/task-42/logo.png`'));
    assert.ok(section.includes('read these files'));
    assert.ok(section.includes('copy them into the project'));
    assert.ok(section.includes('public/'));
    assert.ok(!section.includes('Secret values were redacted'));
  });

  it('uses provided assetFiles without scanning the filesystem', () => {
    const section = buildAssetsAccessInstructions('task-x', tmpDir, {
      assetFiles: ['.aidev/assets/task-x/mockup.svg'],
    });

    assert.ok(section.includes('`.aidev/assets/task-x/mockup.svg`'));
    assert.ok(section.includes('read these files'));
  });

  it('includes secrets guidance when the secrets file exists', () => {
    const taskId = 'task-99';
    const relPath = secretsFileRelPath(taskId).split(path.sep).join('/');
    const secretsDir = path.join(tmpDir, '.aidev', 'assets', 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.writeFileSync(path.join(secretsDir, `task-${taskId}.secrets`), 'KEY=secret\n', 'utf8');

    const section = buildAssetsAccessInstructions(taskId, tmpDir);

    assert.ok(section.includes('## Aidev task assets'));
    assert.ok(section.includes(`\`${relPath}\``));
    assert.ok(section.includes('Secret values were redacted'));
    assert.ok(section.includes('piping values via the terminal instead of reading that file directly'));
    assert.ok(section.includes('Read tool'));
    assert.ok(section.includes('*.secrets'));
    assert.ok(!section.includes('The following attachment files'));
  });

  it('includes both attachments and secrets guidance when both exist', () => {
    const taskId = 'task-both';
    const taskDir = path.join(tmpDir, '.aidev', 'assets', taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'spec.pdf'), 'pdf', 'utf8');

    const relPath = secretsFileRelPath(taskId).split(path.sep).join('/');
    const secretsDir = path.join(tmpDir, '.aidev', 'assets', 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.writeFileSync(path.join(secretsDir, `task-${taskId}.secrets`), 'TOKEN=abc\n', 'utf8');

    const section = buildAssetsAccessInstructions(taskId, tmpDir);

    assert.ok(section.includes('`.aidev/assets/task-both/spec.pdf`'));
    assert.ok(section.includes(`\`${relPath}\``));
    assert.ok(section.includes('read these files'));
    assert.ok(section.includes('Secret values were redacted'));
  });

  it('accepts an explicit secretsRelPath without requiring the file on disk', () => {
    const relPath = '.aidev/assets/secrets/task-custom.secrets';
    const section = buildAssetsAccessInstructions('custom', tmpDir, {
      secretsRelPath: relPath,
    });

    assert.ok(section.includes(`\`${relPath}\``));
    assert.ok(section.includes('Secret values were redacted'));
    assert.ok(!section.includes('The following attachment files'));
  });
});

describe('buildSavedDiffNotice', () => {
  const rel = '.aidev/assets/t1/uncommitted.diff';

  it('says the changes were re-applied', () => {
    const notice = buildSavedDiffNotice('applied', rel);
    assert.ok(notice.includes('previous failed attempt'));
    assert.ok(notice.includes('re-applied'));
    assert.ok(!notice.includes(rel));
  });

  it('asks the agent to resolve conflict markers', () => {
    const notice = buildSavedDiffNotice('conflicts', rel);
    assert.ok(notice.includes('conflict'));
    assert.ok(notice.includes('<<<<<<<'));
  });

  it('points at the diff path when it could not be applied', () => {
    const notice = buildSavedDiffNotice('failed', rel, 'patch does not apply\nmore');
    assert.ok(notice.includes(`\`${rel}\``));
    assert.ok(notice.includes('could not be re-applied'));
    assert.ok(notice.includes('patch does not apply'));
    assert.ok(!notice.includes('more'));
  });
});
