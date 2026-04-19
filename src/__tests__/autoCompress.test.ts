import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { AIRunner } from '../ai/base';
import {
  buildTaskContextSuffix,
  formatConversationBlock,
  fullPromptCharCount,
  maybeCompressHumanComments,
} from '../autoCompress';
import type { Comment, Config } from '../types';

const baseCompressConfig = {
  autoCompress: true,
  autoCompressMaxChars: 100000,
  autoCompressThreshold: 0.8,
} as Config;

describe('fullPromptCharCount', () => {
  it('includes additional context separator when notes present', () => {
    assert.equal(fullPromptCharCount('ab', 'cd'), 'ab'.length + '\n\nAdditional context:\n'.length + 'cd'.length);
  });

  it('omits separator when notes empty', () => {
    assert.equal(fullPromptCharCount('hello'), 5);
  });
});

describe('formatConversationBlock / buildTaskContextSuffix', () => {
  it('returns empty when no comments', () => {
    assert.equal(formatConversationBlock([]), '');
    assert.equal(buildTaskContextSuffix([], ''), '');
  });

  it('joins authors and appends review section', () => {
    const comments: Comment[] = [
      { id: '1', author: 'A', text: 'one', authorId: 'x', date: 1 },
      { id: '2', author: 'B', text: 'two', authorId: 'y', date: 2 },
    ];
    assert.ok(formatConversationBlock(comments).includes('A: one'));
    assert.ok(buildTaskContextSuffix(comments, '\nREV').endsWith('\nREV'));
  });
});

describe('maybeCompressHumanComments', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-autoc-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns unchanged when disabled', async () => {
    const c: Comment[] = [
      { id: '1', author: 'a', text: 'old', authorId: 'u', date: 1 },
      { id: '2', author: 'b', text: 'new', authorId: 'v', date: 2 },
    ];
    const cfg = { ...baseCompressConfig, autoCompress: false } as Config;
    const out = await maybeCompressHumanComments('tid', cfg, c, [], () => 999999);
    assert.deepEqual(out, c);
  });

  it('returns unchanged when at most one comment', async () => {
    const c: Comment[] = [{ id: '1', author: 'a', text: 'only', authorId: 'u', date: 1 }];
    const out = await maybeCompressHumanComments('tid', baseCompressConfig, c, [], () => 999999);
    assert.deepEqual(out, c);
  });

  it('returns unchanged when under tripwire', async () => {
    const c: Comment[] = [
      { id: '1', author: 'a', text: 'old', authorId: 'u', date: 1 },
      { id: '2', author: 'b', text: 'new', authorId: 'v', date: 2 },
    ];
    const out = await maybeCompressHumanComments('tid', baseCompressConfig, c, [], () => 1000);
    assert.deepEqual(out, c);
  });

  it('summarizes earlier comments when over tripwire', async () => {
    const huge = 'h'.repeat(90000);
    const c: Comment[] = [
      { id: '1', author: 'a', text: huge, authorId: 'u', date: 1 },
      { id: '2', author: 'b', text: 'latest instruction', authorId: 'v', date: 2 },
    ];

    const runner: AIRunner = {
      name: 'test',
      isAvailable: () => true,
      run: async () => ({
        success: true,
        output: '- requirement A\n- requirement B',
        error: '',
      }),
    };

    const out = await maybeCompressHumanComments(
      'task-99',
      baseCompressConfig,
      c,
      [runner],
      () => 90000
    );

    assert.equal(out.length, 2);
    assert.equal(out[1]!.text, 'latest instruction');
    assert.ok(out[0]!.text.includes('requirement A'));
    assert.ok(out[0]!.author.includes('compressed'));

    const sessions = path.join(tmpDir, '.aidev', 'sessions');
    assert.ok(fs.existsSync(sessions));
    const files = fs.readdirSync(sessions).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 1);
    const raw = JSON.parse(fs.readFileSync(path.join(sessions, files[0]!), 'utf8')) as { summary: string };
    assert.ok(raw.summary.includes('requirement'));
  });
});
