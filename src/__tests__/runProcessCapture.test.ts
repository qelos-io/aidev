import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withProcessCapture } from '../commands/run';
import type { AIRunner } from '../ai/base';

describe('withProcessCapture', () => {
  it('captures after each run, including failures', async () => {
    const order: string[] = [];
    const ok: AIRunner = {
      name: 'ok', isAvailable: () => true,
      run: async () => { order.push('run'); return { success: true, output: '', error: '' }; },
    };
    const bad: AIRunner = {
      name: 'bad', isAvailable: () => true,
      run: async () => { order.push('run-bad'); throw new Error('boom'); },
    };
    const tracker = { capture: () => { order.push('capture'); } };
    const [w1, w2] = withProcessCapture([ok, bad], tracker);

    assert.equal((await w1.run('p')).success, true);
    await assert.rejects(() => w2.run('p'), /boom/);
    assert.deepEqual(order, ['run', 'capture', 'run-bad', 'capture']);
    assert.equal(w1.name, 'ok');
  });
});
