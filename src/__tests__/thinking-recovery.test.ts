import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  formatSubtaskId,
  subtaskDepth,
  formatSubtaskList,
  readTaskPlan,
  writeTaskPlan,
  splitFailedSubtask,
  buildThinkingSubtaskPrompt,
  truncateForSubtaskPrompt,
  SubTask,
  ThinkingTaskPlan,
  cleanupStaleThinkingArtifacts,
  THINKING_ARTIFACT_MAX_AGE_MS,
  SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX,
} from '../commands/run';
import type { Task } from '../types';
import type { AIRunner, AIRunResult } from '../ai/base';

function stubTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-1',
    name: 'Implement feature X',
    description: 'Build the X feature with sub-systems A and B.',
    status: 'open',
    url: 'https://example.test/t/TASK-1',
    tags: ['thinking'],
    ...overrides,
  };
}

function stubRunner(result: Partial<AIRunResult> & { available?: boolean } = {}): AIRunner {
  return {
    name: 'stub',
    isAvailable: () => result.available ?? true,
    run: async () => ({
      success: result.success ?? true,
      output: result.output ?? '',
      error: result.error ?? '',
    }),
  };
}

// ─── formatSubtaskId ──────────────────────────────────────────────────────────

describe('formatSubtaskId', () => {
  it('appends a trailing dot to numeric IDs', () => {
    assert.equal(formatSubtaskId(3), '3.');
  });

  it('returns string IDs verbatim', () => {
    assert.equal(formatSubtaskId('3.1'), '3.1');
    assert.equal(formatSubtaskId('3.1.2'), '3.1.2');
  });
});

// ─── buildThinkingSubtaskPrompt ───────────────────────────────────────────────

describe('buildThinkingSubtaskPrompt', () => {
  const sub: SubTask = {
    id: 1,
    title: 'Add handler',
    description: 'Edit src/foo.ts and add the route.',
    status: 'pending',
    attempts: 0,
  };
  const basePlan: ThinkingTaskPlan = {
    taskId: 'T-1',
    taskName: 'Feature',
    subtasks: [sub],
  };

  it('uses full task description and full instructions when not compact', () => {
    const task = stubTask({ description: 'Full long description of the feature.' });
    const text = buildThinkingSubtaskPrompt(
      sub,
      task,
      basePlan,
      '## Section\nDo the thing.',
      undefined,
      undefined,
      { compact: false },
    );
    assert.match(text, /Task description:\nFull long description/);
    assert.match(text, /## Full implementation instructions/);
    assert.match(text, /## Section\nDo the thing\./);
  });

  it('uses taskSummary and truncated instructions when compact', () => {
    const task = stubTask({ description: 'X'.repeat(10_000) });
    const plan: ThinkingTaskPlan = {
      ...basePlan,
      taskSummary: 'Build feature X with safe defaults.',
    };
    const longInstr = 'Y'.repeat(20_000);
    const text = buildThinkingSubtaskPrompt(sub, task, plan, longInstr, undefined, undefined, { compact: true });
    assert.match(text, /Goal \(concise\):\nBuild feature X/);
    assert.match(text, /## Implementation plan \(truncated\)/);
    assert.ok(text.length < longInstr.length);
    assert.match(text, /T-1\.aidev\.instructions\.md/);
  });

  it('truncates task description in compact mode when taskSummary is absent', () => {
    const longDesc = 'Z'.repeat(SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX + 500);
    const task = stubTask({ description: longDesc });
    const text = buildThinkingSubtaskPrompt(
      sub,
      task,
      basePlan,
      '',
      undefined,
      undefined,
      { compact: true },
    );
    assert.match(text, /Task description \(truncated\)/);
    assert.match(text, /… \(truncated\)/);
  });

  it('includes previous-attempt diagnostics when previousError is set and not __git__', () => {
    const text = buildThinkingSubtaskPrompt(
      sub,
      stubTask(),
      basePlan,
      '',
      undefined,
      'TypeError: oops',
      { compact: true },
    );
    assert.match(text, /Previous attempt failure diagnostics/);
    assert.match(text, /TypeError: oops/);
  });

  it('omits previous-attempt section for __git__ sentinel', () => {
    const text = buildThinkingSubtaskPrompt(
      sub,
      stubTask(),
      basePlan,
      '',
      undefined,
      '__git__',
      { compact: true },
    );
    assert.doesNotMatch(text, /Previous attempt failure diagnostics/);
  });
});

// ─── truncateForSubtaskPrompt ─────────────────────────────────────────────────

describe('truncateForSubtaskPrompt', () => {
  it('returns the string unchanged when under the limit', () => {
    assert.equal(truncateForSubtaskPrompt('abc', 10), 'abc');
  });

  it('appends an ellipsis marker when over the limit', () => {
    const t = 'a'.repeat(200);
    const out = truncateForSubtaskPrompt(t, 50);
    assert.match(out, /… \(truncated\)/);
    assert.ok(out.length < t.length);
  });
});

// ─── subtaskDepth ─────────────────────────────────────────────────────────────

describe('subtaskDepth', () => {
  it('returns 0 for plain numeric IDs', () => {
    assert.equal(subtaskDepth(3), 0);
  });

  it('counts dots for string IDs', () => {
    assert.equal(subtaskDepth('3.1'), 1);
    assert.equal(subtaskDepth('3.1.1'), 2);
  });
});

// ─── formatSubtaskList ────────────────────────────────────────────────────────

describe('formatSubtaskList', () => {
  it('renders mixed numeric and decimal IDs with status icons', () => {
    const plan: ThinkingTaskPlan = {
      taskId: 'T',
      taskName: 'demo',
      subtasks: [
        { id: 1, title: 'foundations', description: '', status: 'done', attempts: 1 },
        { id: '2.1', title: 'split-a', description: '', status: 'pending', attempts: 0 },
        { id: '2.2', title: 'split-b', description: '', status: 'failed', attempts: 1 },
      ],
    };
    const text = formatSubtaskList(plan);
    assert.match(text, /✅ \*\*1\.\*\* foundations — \*done\*/);
    assert.match(text, /⬜ \*\*2\.1\*\* split-a — \*pending\*/);
    assert.match(text, /❌ \*\*2\.2\*\* split-b — \*failed\*/);
  });
});

// ─── readTaskPlan / writeTaskPlan ─────────────────────────────────────────────

describe('readTaskPlan', () => {
  let tmpDir: string;
  let prevCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-thinking-test-'));
    prevCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no plan file exists', () => {
    assert.equal(readTaskPlan('NONE'), null);
  });

  it('round-trips a plan', () => {
    const plan: ThinkingTaskPlan = {
      taskId: 'TASK-1',
      taskName: 'demo',
      subtasks: [
        { id: 1, title: 'first', description: 'do thing', status: 'done', attempts: 1 },
        { id: 2, title: 'second', description: 'do other', status: 'pending', attempts: 0 },
      ],
    };
    writeTaskPlan(plan);
    const loaded = readTaskPlan('TASK-1');
    assert.ok(loaded);
    assert.equal(loaded!.subtasks.length, 2);
    assert.equal(loaded!.subtasks[0].attempts, 1);
    assert.equal(loaded!.subtasks[1].status, 'pending');
  });

  it('defaults missing attempts to 0 when reading legacy plans', () => {
    // Simulate a plan written by an older aidev version (no `attempts` field).
    const legacy = {
      taskId: 'OLD',
      taskName: 'legacy',
      subtasks: [
        { id: 1, title: 'a', description: 'a', status: 'done' },
        { id: 2, title: 'b', description: 'b', status: 'failed' },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, 'OLD.aidev.task.json'), JSON.stringify(legacy), 'utf8');
    const loaded = readTaskPlan('OLD');
    assert.ok(loaded);
    assert.equal(loaded!.subtasks[0].attempts, 0);
    assert.equal(loaded!.subtasks[1].attempts, 0);
    assert.equal(loaded!.subtasks[1].status, 'failed');
  });

  it('preserves string IDs across round-trip', () => {
    const plan: ThinkingTaskPlan = {
      taskId: 'STR',
      taskName: 'demo',
      subtasks: [
        { id: '3.1', title: 'a', description: 'a', status: 'pending', attempts: 0 },
        { id: '3.2', title: 'b', description: 'b', status: 'pending', attempts: 0 },
      ],
    };
    writeTaskPlan(plan);
    const loaded = readTaskPlan('STR');
    assert.ok(loaded);
    assert.equal(loaded!.subtasks[0].id, '3.1');
    assert.equal(loaded!.subtasks[1].id, '3.2');
  });

  it('round-trips taskSummary', () => {
    const plan: ThinkingTaskPlan = {
      taskId: 'SUM',
      taskName: 'demo',
      taskSummary: 'Ship the widget; keep API stable.',
      subtasks: [{ id: 1, title: 'a', description: 'a', status: 'pending', attempts: 0 }],
    };
    writeTaskPlan(plan);
    const loaded = readTaskPlan('SUM');
    assert.ok(loaded);
    assert.equal(loaded!.taskSummary, 'Ship the widget; keep API stable.');
  });
});

// ─── cleanupStaleThinkingArtifacts ────────────────────────────────────────────

describe('cleanupStaleThinkingArtifacts', () => {
  let tmpDir: string;
  let prevCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-stale-thinking-'));
    prevCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not remove recent artifact files', () => {
    fs.writeFileSync(path.join(tmpDir, 'X.aidev.task.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'X.aidev.instructions.md'), 'x', 'utf8');
    cleanupStaleThinkingArtifacts(tmpDir, Date.now());
    assert.ok(fs.existsSync(path.join(tmpDir, 'X.aidev.task.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'X.aidev.instructions.md')));
  });

  it('removes artifact files older than the max age', () => {
    fs.writeFileSync(path.join(tmpDir, 'OLD.aidev.task.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'OLD.aidev.instructions.md'), 'x', 'utf8');
    const futureNow = Date.now() + THINKING_ARTIFACT_MAX_AGE_MS + 60_000;
    cleanupStaleThinkingArtifacts(tmpDir, futureNow);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'OLD.aidev.task.json')));
    assert.ok(!fs.existsSync(path.join(tmpDir, 'OLD.aidev.instructions.md')));
  });

  it('ignores unrelated filenames', () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'x', 'utf8');
    cleanupStaleThinkingArtifacts(tmpDir, Date.now() + THINKING_ARTIFACT_MAX_AGE_MS + 60_000);
    assert.ok(fs.existsSync(path.join(tmpDir, 'notes.txt')));
  });
});

// ─── splitFailedSubtask ───────────────────────────────────────────────────────

describe('splitFailedSubtask', () => {
  const failedSubtask: SubTask = {
    id: 3,
    title: 'Hard step',
    description: 'Build a complicated thing',
    status: 'failed',
    attempts: 2,
    lastError: 'TypeError: cannot read property foo of undefined',
  };

  function planWith(failed: SubTask): ThinkingTaskPlan {
    return {
      taskId: 'TASK-1',
      taskName: 'demo',
      subtasks: [
        { id: 1, title: 'setup', description: '', status: 'done', attempts: 1 },
        { id: 2, title: 'middle', description: '', status: 'done', attempts: 1 },
        failed,
        { id: 4, title: 'finish', description: '', status: 'pending', attempts: 0 },
      ],
    };
  }

  it('returns null when no runner is available', async () => {
    const result = await splitFailedSubtask(stubTask(), planWith(failedSubtask), failedSubtask, [
      stubRunner({ available: false }),
    ]);
    assert.equal(result, null);
  });

  it('returns null when the runner reports failure', async () => {
    const result = await splitFailedSubtask(stubTask(), planWith(failedSubtask), failedSubtask, [
      stubRunner({ success: false, output: '', error: 'no api key' }),
    ]);
    assert.equal(result, null);
  });

  it('returns null when the runner output has no JSON', async () => {
    const result = await splitFailedSubtask(stubTask(), planWith(failedSubtask), failedSubtask, [
      stubRunner({ output: 'sorry, I cannot do that' }),
    ]);
    assert.equal(result, null);
  });

  it('returns null when JSON contains the wrong number of subtasks', async () => {
    const result = await splitFailedSubtask(stubTask(), planWith(failedSubtask), failedSubtask, [
      stubRunner({
        output: JSON.stringify({
          subtasks: [{ title: 'only one', description: 'oops' }],
        }),
      }),
    ]);
    assert.equal(result, null);
  });

  it('returns null when a sub-task has empty title or description', async () => {
    const result = await splitFailedSubtask(stubTask(), planWith(failedSubtask), failedSubtask, [
      stubRunner({
        output: JSON.stringify({
          subtasks: [
            { title: '', description: 'ok' },
            { title: 'b', description: 'ok' },
          ],
        }),
      }),
    ]);
    assert.equal(result, null);
  });

  it('produces 2 sub-tasks with .1/.2 IDs when given valid JSON', async () => {
    const canned = {
      subtasks: [
        { title: 'Foundations', description: 'Lay the groundwork' },
        { title: 'Wiring', description: 'Connect the pieces' },
      ],
    };
    const result = await splitFailedSubtask(stubTask(), planWith(failedSubtask), failedSubtask, [
      stubRunner({ output: JSON.stringify(canned) }),
    ]);
    assert.ok(result);
    assert.equal(result!.length, 2);
    assert.equal(result![0].id, '3.1');
    assert.equal(result![1].id, '3.2');
    assert.equal(result![0].title, 'Foundations');
    assert.equal(result![1].title, 'Wiring');
    assert.equal(result![0].status, 'pending');
    assert.equal(result![0].attempts, 0);
    assert.equal(result![1].attempts, 0);
  });

  it('produces nested IDs (3.1.1, 3.1.2) when splitting a decimal-ID step', async () => {
    const nestedFailed: SubTask = { ...failedSubtask, id: '3.1' };
    const canned = {
      subtasks: [
        { title: 'a', description: 'a' },
        { title: 'b', description: 'b' },
      ],
    };
    const result = await splitFailedSubtask(stubTask(), planWith(nestedFailed), nestedFailed, [
      stubRunner({ output: JSON.stringify(canned) }),
    ]);
    assert.ok(result);
    assert.equal(result![0].id, '3.1.1');
    assert.equal(result![1].id, '3.1.2');
  });

  it('extracts JSON when wrapped in extraneous prose', async () => {
    const wrapped = `Sure! Here is the split:\n${JSON.stringify({
      subtasks: [
        { title: 'one', description: 'first' },
        { title: 'two', description: 'second' },
      ],
    })}\nHope that helps.`;
    const result = await splitFailedSubtask(stubTask(), planWith(failedSubtask), failedSubtask, [
      stubRunner({ output: wrapped }),
    ]);
    assert.ok(result);
    assert.equal(result!.length, 2);
  });

  it('uses the first available runner', async () => {
    let secondCalled = false;
    const runners: AIRunner[] = [
      { name: 'unavail', isAvailable: () => false, run: async () => ({ success: false, output: '', error: '' }) },
      {
        name: 'real',
        isAvailable: () => true,
        run: async () => {
          secondCalled = true;
          return {
            success: true,
            output: JSON.stringify({
              subtasks: [
                { title: 'x', description: 'x' },
                { title: 'y', description: 'y' },
              ],
            }),
            error: '',
          };
        },
      },
    ];
    const result = await splitFailedSubtask(stubTask(), planWith(failedSubtask), failedSubtask, runners);
    assert.ok(result);
    assert.ok(secondCalled);
  });

  it('passes diagnostics into the runner prompt', async () => {
    let capturedPrompt = '';
    const runner: AIRunner = {
      name: 'spy',
      isAvailable: () => true,
      run: async (prompt) => {
        capturedPrompt = prompt;
        return {
          success: true,
          output: JSON.stringify({
            subtasks: [
              { title: 'a', description: 'a' },
              { title: 'b', description: 'b' },
            ],
          }),
          error: '',
        };
      },
    };
    await splitFailedSubtask(stubTask(), planWith(failedSubtask), failedSubtask, [runner]);
    assert.match(capturedPrompt, /TypeError: cannot read property foo of undefined/);
    assert.match(capturedPrompt, /Hard step/);
  });

  it('omits the __git__ sentinel from diagnostics in the prompt', async () => {
    let capturedPrompt = '';
    const runner: AIRunner = {
      name: 'spy',
      isAvailable: () => true,
      run: async (prompt) => {
        capturedPrompt = prompt;
        return {
          success: true,
          output: JSON.stringify({
            subtasks: [
              { title: 'a', description: 'a' },
              { title: 'b', description: 'b' },
            ],
          }),
          error: '',
        };
      },
    };
    const gitFailed: SubTask = { ...failedSubtask, lastError: '__git__' };
    await splitFailedSubtask(stubTask(), planWith(gitFailed), gitFailed, [runner]);
    assert.doesNotMatch(capturedPrompt, /__git__/);
    assert.match(capturedPrompt, /\(no diagnostics captured\)/);
  });
});
