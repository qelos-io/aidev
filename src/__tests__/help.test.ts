import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { windowsCursorAgentLine } from '../commands/help';

describe('windowsCursorAgentLine', () => {
  it('returns empty string when not Windows', () => {
    const out = windowsCursorAgentLine({ isWindows: false, agentExists: false });
    assert.equal(out, '');
  });

  it('returns empty string when isWindows is false even if agent exists', () => {
    const out = windowsCursorAgentLine({ isWindows: false, agentExists: true });
    assert.equal(out, '');
  });

  it('returns line with checkmark when Windows and agent exists', () => {
    const out = windowsCursorAgentLine({ isWindows: true, agentExists: true });
    assert.ok(out.includes('CURSOR (WINDOWS)'));
    assert.ok(out.includes('✓'));
    assert.ok(out.includes('agent'));
    assert.ok(out.includes('available'));
  });

  it('returns line with install hint when Windows and agent missing', () => {
    const out = windowsCursorAgentLine({ isWindows: true, agentExists: false });
    assert.ok(out.includes('CURSOR (WINDOWS)'));
    assert.ok(out.includes('!'));
    assert.ok(out.includes('Install'));
    assert.ok(out.includes('cursor.com/install?win32=true'));
    assert.ok(out.includes('iex'));
  });
});
