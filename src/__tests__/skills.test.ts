import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveSkillContent } from '../skills';

describe('resolveSkillContent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-skills-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function skillsBase(cwd = tmpDir): string {
    return path.join(cwd, '.agents', 'skills');
  }

  it('returns content from .agents/skills/aidev-review/SKILL.md', () => {
    const skillDir = path.join(skillsBase(), 'aidev-review');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '  custom review prompt  \n', 'utf8');

    assert.equal(resolveSkillContent('aidev-review', tmpDir), 'custom review prompt');
  });

  it('falls back to .agents/skills/aidev-review.md', () => {
    const skillsDir = skillsBase();
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'aidev-review.md'), 'fallback md prompt\n', 'utf8');

    assert.equal(resolveSkillContent('aidev-review', tmpDir), 'fallback md prompt');
  });

  it('falls back to .agents/skills/aidev-review (no extension)', () => {
    const skillsDir = skillsBase();
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'aidev-review'), 'plain file prompt\n', 'utf8');

    assert.equal(resolveSkillContent('aidev-review', tmpDir), 'plain file prompt');
  });

  it('returns null when nothing matches', () => {
    assert.equal(resolveSkillContent('aidev-review', tmpDir), null);
  });

  it('respects custom cwd argument', () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-skills-other-'));
    try {
      const skillDir = path.join(otherDir, '.agents', 'skills', 'aidev-review');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'other cwd prompt', 'utf8');

      assert.equal(resolveSkillContent('aidev-review', otherDir), 'other cwd prompt');
      assert.equal(resolveSkillContent('aidev-review', tmpDir), null);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
