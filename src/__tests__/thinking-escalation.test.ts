import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildThinkingEscalationContext } from '../prompts/shared';

describe('buildThinkingEscalationContext', () => {
  it('includes failure diagnostics in the previous direct-run section', () => {
    const diagnostics = 'Runner claude failed: timeout after 300s';
    const context = buildThinkingEscalationContext(diagnostics, []);

    assert.match(context, /## Previous direct-run failure/);
    assert.match(context, /Runner claude failed: timeout after 300s/);
  });

  it('lists uncommitted files when paths are provided', () => {
    const context = buildThinkingEscalationContext('all runners failed', [
      'src/foo.ts',
      'src/bar.ts',
    ]);

    assert.match(context, /## Uncommitted working-tree changes/);
    assert.match(context, /partial work in your breakdown/);
    assert.match(context, /- src\/foo\.ts/);
    assert.match(context, /- src\/bar\.ts/);
  });

  it('omits the uncommitted files section when no paths are provided', () => {
    const context = buildThinkingEscalationContext('all runners failed', []);

    assert.match(context, /## Previous direct-run failure/);
    assert.doesNotMatch(context, /## Uncommitted working-tree changes/);
  });
});
