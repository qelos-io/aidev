import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('node:child_process');
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isGitUrl, detectLayout, resolveSkillsSource, skillsCacheDirFor } from '../skills-source';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-skills-test-'));
});

afterEach(() => {
  mock.restoreAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function cfg(source: string, branch = 'main', subdir = '') {
  return { skillsSource: source, skillsBranch: branch, skillsSubdir: subdir };
}

describe('isGitUrl', () => {
  it('detects URLs', () => {
    assert.equal(isGitUrl('https://github.com/a/b'), true);
    assert.equal(isGitUrl('git@github.com:a/b.git'), true);
    assert.equal(isGitUrl('ssh://git@host/a/b'), true);
    assert.equal(isGitUrl('/some/path/repo.git'), true);
  });
  it('treats paths as non-URLs', () => {
    assert.equal(isGitUrl('/home/me/skills'), false);
    assert.equal(isGitUrl('C:\\skills'), false);
    assert.equal(isGitUrl('./skills'), false);
    assert.equal(isGitUrl(''), false);
  });
  it('rejects option-like values', () => {
    assert.equal(isGitUrl('--upload-pack=evil.git'), false);
  });
});

describe('detectLayout', () => {
  it('finds skills, rules and agents folders', () => {
    fs.mkdirSync(path.join(tmp, 'skills'));
    fs.mkdirSync(path.join(tmp, '.cursor', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude', 'agents'), { recursive: true });
    const l = detectLayout(tmp);
    assert.equal(l.skillsDir, path.join(tmp, 'skills'));
    assert.equal(l.rulesDir, path.join(tmp, '.cursor', 'rules'));
    assert.equal(l.agentsDir, path.join(tmp, '.claude', 'agents'));
  });
  it('supports .agents layout', () => {
    fs.mkdirSync(path.join(tmp, '.agents', 'skills'), { recursive: true });
    assert.equal(detectLayout(tmp).skillsDir, path.join(tmp, '.agents', 'skills'));
  });
  it('treats a flat folder of SKILL.md dirs as skills', () => {
    fs.mkdirSync(path.join(tmp, 'foo'));
    fs.writeFileSync(path.join(tmp, 'foo', 'SKILL.md'), '# x');
    const l = detectLayout(tmp);
    assert.equal(l.skillsDir, tmp);
    assert.equal(l.rulesDir, undefined);
  });
});

describe('resolveSkillsSource (local)', () => {
  it('returns null when unset', () => {
    assert.equal(resolveSkillsSource(cfg('')), null);
  });
  it('throws for a missing path', () => {
    assert.throws(() => resolveSkillsSource(cfg(path.join(tmp, 'nope'))), /does not exist/);
  });
  it('throws for a file', () => {
    const f = path.join(tmp, 'f.txt');
    fs.writeFileSync(f, 'x');
    assert.throws(() => resolveSkillsSource(cfg(f)), /not a directory/);
  });
  it('applies subdir and rejects escapes', () => {
    fs.mkdirSync(path.join(tmp, 'sub', 'skills'), { recursive: true });
    const r = resolveSkillsSource(cfg(tmp, 'main', 'sub'))!;
    assert.equal(r.rootDir, path.join(tmp, 'sub'));
    assert.equal(r.skillsDir, path.join(tmp, 'sub', 'skills'));
    assert.equal(r.isGit, false);
    assert.throws(() => resolveSkillsSource(cfg(tmp, 'main', '..')), /inside/);
  });
});

describe('resolveSkillsSource (git, mocked spawnSync)', () => {
  const URL = 'https://example.com/team/skills.git';
  let calls: string[][];

  function mockGit(handler: (args: string[], cwd?: string) => { status: number; stdout?: string; stderr?: string }) {
    calls = [];
    mock.method(childProcess, 'spawnSync', (_cmd: string, args: string[], options: { cwd?: string }) => {
      assert.equal(_cmd, 'git');
      assert.ok(Array.isArray(args));
      calls.push(args);
      const r = handler(args, options?.cwd);
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    });
  }

  const cacheRoot = () => path.join(tmp, 'cache');

  it('clones when missing, then fetches and resets to origin/main', () => {
    const dir = skillsCacheDirFor(URL, cacheRoot());
    mockGit((args) => {
      if (args[0] === 'clone') {
        fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'skills'));
        fs.writeFileSync(path.join(dir, 'skills', 'a.md'), 'x');
      }
      if (args[0] === 'ls-remote') return { status: 0, stdout: 'abc\trefs/heads/main\n' };
      return { status: 0 };
    });
    const r = resolveSkillsSource(cfg(URL), { cacheRoot: cacheRoot() })!;
    assert.equal(r.isGit, true);
    assert.equal(r.skillsDir, path.join(dir, 'skills'));
    const names = calls.map((a) => a[0]);
    assert.deepEqual(names, ['clone', 'ls-remote', 'fetch', 'checkout', 'reset']);
    assert.deepEqual(calls[0], ['clone', '--quiet', '--', URL, dir]);
    assert.ok(calls[2].includes('+refs/heads/main:refs/remotes/origin/main'));
    assert.deepEqual(calls[4], ['reset', '--quiet', '--hard', 'origin/main']);
    assert.equal(fs.existsSync(`${dir}.lock`), false);
  });

  it('skips clone for an existing cache and falls back to master', () => {
    const dir = skillsCacheDirFor(URL, cacheRoot());
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    mockGit((args) => {
      if (args[0] === 'ls-remote') {
        return { status: 0, stdout: args.includes('refs/heads/master') ? 'abc\trefs/heads/master\n' : '' };
      }
      return { status: 0 };
    });
    resolveSkillsSource(cfg(URL), { cacheRoot: cacheRoot() });
    assert.ok(!calls.some((a) => a[0] === 'clone'));
    assert.deepEqual(calls[calls.length - 1], ['reset', '--quiet', '--hard', 'origin/master']);
  });

  it('uses the existing cache when the network fails', () => {
    const dir = skillsCacheDirFor(URL, cacheRoot());
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    mockGit((args) => (args[0] === 'ls-remote' ? { status: 128, stderr: 'no network' } : { status: 0 }));
    const r = resolveSkillsSource(cfg(URL), { cacheRoot: cacheRoot() })!;
    assert.equal(r.rootDir, dir);
    assert.ok(!calls.some((a) => a[0] === 'reset'));
  });

  it('fails with a clear message when clone fails and there is no cache', () => {
    mockGit((args) => (args[0] === 'clone' ? { status: 128, stderr: 'auth failed' } : { status: 0 }));
    assert.throws(
      () => resolveSkillsSource(cfg(URL), { cacheRoot: cacheRoot() }),
      /Cannot access skills repository.*auth failed/,
    );
  });

  it('makes cache files read-only after update', () => {
    const dir = skillsCacheDirFor(URL, cacheRoot());
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'skills'));
    const file = path.join(dir, 'skills', 'a.md');
    fs.writeFileSync(file, 'x');
    mockGit((args) => (args[0] === 'ls-remote' ? { status: 0, stdout: 'abc\trefs/heads/main\n' } : { status: 0 }));
    resolveSkillsSource(cfg(URL), { cacheRoot: cacheRoot() });
    assert.throws(() => fs.writeFileSync(file, 'y'), /EPERM|EACCES/);
    // restore so cleanup works
    fs.chmodSync(file, 0o644);
  });
});
