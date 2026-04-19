import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '../logger';
import {
  shouldCompress,
  fingerprintComments,
  buildCompressedContext,
  getSessionPath,
} from '../sessions';
import type { Comment, Config } from '../types';
import type { AIRunner, AIRunResult } from '../ai/base';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type StubRunnerOptions = {
  name?: string;
  available?: boolean;
  output?: string;
  success?: boolean;
};

function makeStubRunner(opts: StubRunnerOptions = {}): AIRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: opts.name ?? 'stub',
    calls,
    isAvailable: () => opts.available !== false,
    run: async (prompt: string): Promise<AIRunResult> => {
      calls.push(prompt);
      return {
        success: opts.success !== false,
        output: opts.output ?? '--stub summary--',
        error: '',
      };
    },
  };
}

function configWith(overrides: Partial<Config>): Config {
  return { autoCompress: true, compressThreshold: 12000, ...overrides } as Config;
}

function mkComment(id: string, text: string, author = 'alice'): Comment {
  return { id, text, author, authorId: author, date: 0 };
}

// ─── shouldCompress ───────────────────────────────────────────────────────────

describe('shouldCompress', () => {
  it('returns false when prompt length is just under the threshold', () => {
    assert.equal(shouldCompress('a'.repeat(99), 100), false);
  });

  it('returns false when prompt length equals the threshold', () => {
    assert.equal(shouldCompress('a'.repeat(100), 100), false);
  });

  it('returns true when prompt length is just over the threshold', () => {
    assert.equal(shouldCompress('a'.repeat(101), 100), true);
  });
});

// ─── fingerprintComments ──────────────────────────────────────────────────────

describe('fingerprintComments', () => {
  it('produces the same hash for identical comment lists', () => {
    const a = [mkComment('1', 'hello'), mkComment('2', 'world')];
    const b = [mkComment('1', 'hello'), mkComment('2', 'world')];
    assert.equal(fingerprintComments(a), fingerprintComments(b));
  });

  it('changes when a comment text is edited', () => {
    const a = [mkComment('1', 'hello'), mkComment('2', 'world')];
    const b = [mkComment('1', 'hello'), mkComment('2', 'WORLD')];
    assert.notEqual(fingerprintComments(a), fingerprintComments(b));
  });

  it('changes when a comment id differs', () => {
    const a = [mkComment('1', 'hello'), mkComment('2', 'world')];
    const b = [mkComment('1', 'hello'), mkComment('3', 'world')];
    assert.notEqual(fingerprintComments(a), fingerprintComments(b));
  });

  it('changes when comments are reordered', () => {
    const a = [mkComment('1', 'hello'), mkComment('2', 'world')];
    const b = [mkComment('2', 'world'), mkComment('1', 'hello')];
    assert.notEqual(fingerprintComments(a), fingerprintComments(b));
  });
});

// ─── buildCompressedContext ──────────────────────────────────────────────────

describe('buildCompressedContext', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-sessions-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // silence warnings from deterministic-truncation fallback path
    mock.method(logger, 'warn', () => {});
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    mock.restoreAll();
  });

  function longComment(id: string, sizeChars: number, author = 'alice'): Comment {
    return mkComment(id, 'x'.repeat(sizeChars), author);
  }

  it('preserves the latest comment verbatim and includes the summary; writes a session file', async () => {
    const comments = [
      longComment('a', 5000, 'alice'),
      longComment('b', 5000, 'bob'),
      mkComment('c', 'LATEST-UNIQUE-TEXT', 'carol'),
    ];
    const runner = makeStubRunner({ output: 'SUMMARY-OF-EARLIER' });

    const result = await buildCompressedContext(
      comments,
      'task-1',
      [runner],
      configWith({ compressThreshold: 100 }),
    );

    assert.ok(result.includes('Summary of earlier conversation'));
    assert.ok(result.includes('SUMMARY-OF-EARLIER'));
    assert.ok(result.includes('Latest comment:'));
    assert.ok(result.includes('carol: LATEST-UNIQUE-TEXT'));
    // earlier comments should not appear verbatim in the compressed output
    assert.equal(result.includes('alice: '), false);
    assert.equal(result.includes('bob: '), false);
    assert.equal(runner.calls.length, 1);

    const sessionPath = getSessionPath('task-1');
    assert.ok(fs.existsSync(sessionPath), 'session file written');
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    assert.equal(session.taskId, 'task-1');
    assert.equal(session.summary, 'SUMMARY-OF-EARLIER');
    assert.equal(session.lastCommentId, 'c');
    assert.equal(typeof session.fingerprint, 'string');
    assert.equal(session.fingerprint.length > 0, true);
  });

  it('returns raw context unchanged when autoCompress is false', async () => {
    const comments = [
      longComment('a', 5000, 'alice'),
      longComment('b', 5000, 'bob'),
      mkComment('c', 'latest', 'carol'),
    ];
    const runner = makeStubRunner({ output: 'should-not-appear' });

    const result = await buildCompressedContext(
      comments,
      'task-noauto',
      [runner],
      configWith({ autoCompress: false, compressThreshold: 100 }),
    );

    assert.ok(result.includes('Conversation context:'));
    assert.ok(result.includes('alice: '));
    assert.ok(result.includes('bob: '));
    assert.ok(result.includes('carol: latest'));
    assert.equal(result.includes('Summary of earlier conversation'), false);
    assert.equal(result.includes('should-not-appear'), false);
    assert.equal(runner.calls.length, 0);
    assert.equal(fs.existsSync(getSessionPath('task-noauto')), false);
  });

  it('reuses the cached summary on a second call with the same fingerprint (no runner invocation)', async () => {
    const comments = [
      longComment('a', 5000, 'alice'),
      longComment('b', 5000, 'bob'),
      mkComment('c', 'latest', 'carol'),
    ];
    const cfg = configWith({ compressThreshold: 100 });

    const first = makeStubRunner({ output: 'FIRST-SUMMARY' });
    const r1 = await buildCompressedContext(comments, 'task-cached', [first], cfg);
    assert.ok(r1.includes('FIRST-SUMMARY'));
    assert.equal(first.calls.length, 1);

    // second call: same earlier comments → same fingerprint → cache hit
    const second = makeStubRunner({ output: 'WOULD-REPLACE' });
    const r2 = await buildCompressedContext(comments, 'task-cached', [second], cfg);
    assert.ok(r2.includes('FIRST-SUMMARY'));
    assert.equal(r2.includes('WOULD-REPLACE'), false);
    assert.equal(second.calls.length, 0);
  });

  it('re-summarizes when an earlier comment is edited (fingerprint miss)', async () => {
    const last = mkComment('c', 'latest', 'carol');
    const cfg = configWith({ compressThreshold: 100 });

    const r1 = makeStubRunner({ output: 'SUM-V1' });
    await buildCompressedContext(
      [longComment('a', 5000, 'alice'), longComment('b', 5000, 'bob'), last],
      'task-edit',
      [r1],
      cfg,
    );
    assert.equal(r1.calls.length, 1);

    // edit text of an earlier comment → fingerprint changes → runner re-invoked
    const r2 = makeStubRunner({ output: 'SUM-V2' });
    const edited = await buildCompressedContext(
      [longComment('a', 5000, 'alice'), mkComment('b', 'edited body ' + 'y'.repeat(5000), 'bob'), last],
      'task-edit',
      [r2],
      cfg,
    );
    assert.ok(edited.includes('SUM-V2'));
    assert.equal(r2.calls.length, 1);
  });

  it('re-summarizes when a new latest comment arrives (previous last moves into earlier)', async () => {
    const earlier = [longComment('a', 5000, 'alice'), longComment('b', 5000, 'bob')];
    const cfg = configWith({ compressThreshold: 100 });

    const r1 = makeStubRunner({ output: 'SUM-A' });
    await buildCompressedContext(
      [...earlier, mkComment('c', 'first latest', 'carol')],
      'task-newlast',
      [r1],
      cfg,
    );
    assert.equal(r1.calls.length, 1);

    const r2 = makeStubRunner({ output: 'SUM-B' });
    const result = await buildCompressedContext(
      [
        ...earlier,
        mkComment('c', 'first latest', 'carol'),
        mkComment('d', 'newer latest', 'dan'),
      ],
      'task-newlast',
      [r2],
      cfg,
    );
    assert.ok(result.includes('SUM-B'));
    assert.ok(result.includes('dan: newer latest'));
    assert.equal(r2.calls.length, 1);
  });

  it('falls back to deterministic truncation when all runners are unavailable and still writes a session', async () => {
    const comments = [
      longComment('a', 5000, 'alice'),
      longComment('b', 5000, 'bob'),
      mkComment('c', 'latest', 'carol'),
    ];
    const unavailable = makeStubRunner({ available: false, output: 'unused' });

    const result = await buildCompressedContext(
      comments,
      'task-fallback',
      [unavailable],
      configWith({ compressThreshold: 100 }),
    );

    assert.ok(result.includes('Summary of earlier conversation'));
    assert.ok(result.includes('carol: latest'));
    assert.equal(unavailable.calls.length, 0);

    const sessionPath = getSessionPath('task-fallback');
    assert.ok(fs.existsSync(sessionPath), 'session file must be written on fallback');
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    assert.equal(session.taskId, 'task-fallback');
    assert.equal(session.lastCommentId, 'c');
    assert.equal(typeof session.summary, 'string');
    assert.equal(session.summary.length > 0, true);
    // deterministic truncation: summary stays within ~first 1500 + last 1500 chars (+ separator)
    assert.ok(session.summary.length < 3100);
  });
});
