import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { repairCorruptHead } from '../git';

function run(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

describe('repairCorruptHead', () => {
  let root: string;
  let work: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-head-'));
    const bare = path.join(root, 'remote.git');
    work = path.join(root, 'work');
    fs.mkdirSync(bare);
    run(bare, 'init', '--bare', '-b', 'main');
    fs.mkdirSync(work);
    run(work, 'init', '-b', 'main');
    run(work, 'config', 'user.email', 't@t.t');
    run(work, 'config', 'user.name', 't');
    run(work, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(work, 'a.txt'), 'a');
    run(work, 'add', '.');
    run(work, 'commit', '-m', 'init');
    run(work, 'remote', 'add', 'origin', bare);
    run(work, 'push', '-u', 'origin', 'main');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns ok for a healthy repo', () => {
    assert.equal(repairCorruptHead('origin', 'main', work), 'ok');
  });

  it('treats an unborn branch as healthy', () => {
    const fresh = path.join(root, 'fresh');
    fs.mkdirSync(fresh);
    run(fresh, 'init', '-b', 'main');
    assert.equal(repairCorruptHead('origin', 'main', fresh), 'ok');
  });

  it('repairs an empty branch ref file from the remote', () => {
    const expected = run(work, 'rev-parse', 'origin/main');
    fs.writeFileSync(path.join(work, '.git', 'refs', 'heads', 'main'), '');
    assert.equal(repairCorruptHead('origin', 'main', work), 'repaired');
    assert.equal(run(work, 'rev-parse', 'HEAD'), expected);
  });

  it('falls back to the base branch when the remote lacks the current branch', () => {
    run(work, 'checkout', '-b', 'feature');
    fs.writeFileSync(path.join(work, '.git', 'refs', 'heads', 'feature'), '');
    assert.equal(repairCorruptHead('origin', 'main', work), 'repaired');
    assert.equal(run(work, 'rev-parse', 'HEAD'), run(work, 'rev-parse', 'origin/main'));
  });

  it('reports failed when no remote ref is available', () => {
    run(work, 'update-ref', '-d', 'refs/remotes/origin/main');
    fs.writeFileSync(path.join(work, '.git', 'refs', 'heads', 'main'), '');
    run(work, 'remote', 'remove', 'origin');
    assert.equal(repairCorruptHead('origin', 'main', work), 'failed');
  });
});
