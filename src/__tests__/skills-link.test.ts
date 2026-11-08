import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { linkSkills, unlinkSkills, unlinkAllSkills, DEFAULT_LINK_TARGETS } from '../skills-link';
import type { ResolvedSkillsSource } from '../skills-source';

let tmp: string;
let repo: string;
let src: ResolvedSkillsSource;

function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-link-test-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  const root = path.join(tmp, 'skills-src');
  fs.mkdirSync(path.join(root, 'skills', 's1'), { recursive: true });
  fs.mkdirSync(path.join(root, 'rules'));
  fs.writeFileSync(path.join(root, 'skills', 's1', 'SKILL.md'), 'x');
  src = { rootDir: root, skillsDir: path.join(root, 'skills'), rulesDir: path.join(root, 'rules'), isGit: false };
});

afterEach(() => {
  unlinkAllSkills();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('skills-link', () => {
  it('creates links to the matching source dirs and exposes content', () => {
    const set = linkSkills(repo, src);
    assert.equal(set.links.length, 2);
    const skillsLink = path.join(repo, '.agents', 'skills', 'aidev-skills');
    assert.ok(fs.existsSync(path.join(skillsLink, 's1', 'SKILL.md')));
    assert.ok(fs.lstatSync(path.join(repo, '.agents', 'rules', 'aidev-skills')).isSymbolicLink());
  });

  it('adds the local git exclude entry', () => {
    linkSkills(repo, src);
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    assert.match(exclude, /^aidev-skills$/m);
  });

  it('skips kinds the source does not have', () => {
    const set = linkSkills(repo, { ...src, rulesDir: undefined });
    assert.equal(set.links.length, 1);
    assert.ok(!exists(path.join(repo, '.agents', 'rules')));
  });

  it('never overwrites a real directory or file', () => {
    const real = path.join(repo, '.agents', 'skills', 'aidev-skills');
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, 'mine.md'), 'keep');
    const set = linkSkills(repo, src, DEFAULT_LINK_TARGETS);
    assert.equal(set.links.length, 1); // only rules
    unlinkSkills(set);
    assert.equal(fs.readFileSync(path.join(real, 'mine.md'), 'utf8'), 'keep');
    assert.ok(fs.lstatSync(real).isDirectory() && !fs.lstatSync(real).isSymbolicLink());
  });

  it('unlink removes links and created dirs but not the source', () => {
    const set = linkSkills(repo, src);
    unlinkSkills(set);
    assert.ok(!exists(path.join(repo, '.agents')));
    assert.ok(fs.existsSync(path.join(src.skillsDir!, 's1', 'SKILL.md')));
  });

  it('keeps pre-existing parent dirs and their content', () => {
    fs.mkdirSync(path.join(repo, '.agents', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.agents', 'skills', 'own.md'), 'own');
    unlinkSkills(linkSkills(repo, src));
    assert.ok(fs.existsSync(path.join(repo, '.agents', 'skills', 'own.md')));
    assert.ok(!exists(path.join(repo, '.agents', 'skills', 'aidev-skills')));
  });

  it('does not remove a link that was replaced by something else', () => {
    const set = linkSkills(repo, src);
    const l = path.join(repo, '.agents', 'skills', 'aidev-skills');
    fs.rmSync(l, { recursive: true, force: true });
    fs.mkdirSync(l);
    unlinkSkills(set);
    assert.ok(fs.lstatSync(l).isDirectory());
  });

  it('unlinkAllSkills cleans active sets', () => {
    linkSkills(repo, src);
    unlinkAllSkills();
    assert.ok(!exists(path.join(repo, '.agents')));
  });

  it('adopts a leftover link with the same target and cleans it up', () => {
    linkSkills(repo, src); // simulate crashed run: never unlinked
    const second = linkSkills(repo, src);
    assert.equal(second.links.length, 2);
    unlinkSkills(second);
    assert.ok(!exists(path.join(repo, '.agents', 'skills', 'aidev-skills')));
  });
});
