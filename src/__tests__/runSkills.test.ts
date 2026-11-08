import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCommand } from '../commands/run';
import { setupSkills, withSkillsContext } from '../skills-runtime';
import { logger } from '../logger';
import { LOCK_FILENAME } from '../lockfile';
import { AIDEV_SKILLS_LINK_NAME } from '../git';
import type { Config } from '../types';
import type { TaskProvider } from '../providers/base';
import type { AIRunner, AIRunOptions } from '../ai/base';

function makeRunner(name: string, supportsExternalContext?: boolean, seen: (AIRunOptions | undefined)[] = []): AIRunner {
  return {
    name,
    supportsExternalContext,
    isAvailable: () => true,
    run: async (_p, _n, options) => {
      seen.push(options);
      return { success: true, output: '', error: '' };
    },
  };
}

function makeProvider(overrides: Partial<TaskProvider> = {}): TaskProvider {
  return {
    fetchTasks: async () => [],
    fetchTasksByStatus: async () => [],
    getComments: async () => [],
    postComment: async () => {},
    updateStatus: async () => {},
    ...overrides,
  } as TaskProvider;
}

describe('run flow — skills source wiring', () => {
  let originalCwd: string;
  let tmpDir: string;
  let skillsDir: string;
  let repoDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-runskills-'));
    skillsDir = path.join(tmpDir, 'team-skills');
    fs.mkdirSync(path.join(skillsDir, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'skills', 'demo', 'SKILL.md'), '# demo');
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(repoDir);
    process.chdir(repoDir);
    mock.method(logger, 'info', () => {});
    mock.method(logger, 'warn', () => {});
    mock.method(logger, 'success', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
    process.chdir(originalCwd);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function cfg(): Config {
    return {
      provider: 'local', projectName: 'p', gitRemote: 'origin', githubBaseBranch: 'main',
      agents: ['claude'], skillsSource: skillsDir, skillsBranch: 'main', skillsSubdir: '',
    } as unknown as Config;
  }

  it('is a no-op without a skills source', () => {
    const runners = [makeRunner('antigravity')];
    const rt = setupSkills({ skillsSource: '', skillsBranch: 'main', skillsSubdir: '' }, runners, repoDir);
    assert.equal(rt.source, null);
    assert.equal(rt.runners, runners);
    assert.equal(fs.existsSync(path.join(repoDir, '.agents')), false);
  });

  it('injects extraContext into every run without overriding an explicit one', async () => {
    const seen: (AIRunOptions | undefined)[] = [];
    const rt = setupSkills(cfg(), [makeRunner('claude', true, seen)], repoDir);
    await rt.runners[0].run('p');
    await rt.runners[0].run('p', undefined, { extraContext: { rootDir: 'x' } });
    assert.equal(seen[0]?.extraContext?.rootDir, path.resolve(skillsDir));
    assert.equal(seen[0]?.extraContext?.skillsDir, path.join(path.resolve(skillsDir), 'skills'));
    assert.equal(seen[1]?.extraContext?.rootDir, 'x');
    assert.equal(rt.runners[0].supportsExternalContext, true);
  });

  it('creates no links when every runner takes the source directly', () => {
    const rt = setupSkills(cfg(), [makeRunner('claude', true)], repoDir);
    assert.equal(fs.existsSync(path.join(repoDir, '.agents')), false);
    rt.cleanup();
  });

  it('links only for runners without support and cleanup removes them', () => {
    const rt = setupSkills(cfg(), [makeRunner('claude', true), makeRunner('devin')], repoDir);
    const link = path.join(repoDir, '.agents', 'skills', AIDEV_SKILLS_LINK_NAME);
    assert.ok(fs.lstatSync(link).isSymbolicLink() || fs.lstatSync(link).isDirectory());
    rt.cleanup();
    rt.cleanup(); // idempotent
    assert.equal(fs.existsSync(link), false);
    assert.equal(fs.existsSync(path.join(repoDir, '.agents')), false);
  });

  it('withSkillsContext preserves runner metadata', () => {
    const r = makeRunner('x', true);
    r.supportsSessions = true;
    const [w] = withSkillsContext([r], { rootDir: 'r' });
    assert.equal(w.name, 'x');
    assert.equal(w.supportsSessions, true);
    assert.equal(w.supportsExternalContext, true);
  });

  it('runCommand exposes links during the run and removes them afterwards', async () => {
    const link = path.join(repoDir, '.agents', 'skills', AIDEV_SKILLS_LINK_NAME);
    let linkedDuringRun = false;
    const provider = makeProvider({
      fetchTasks: async () => {
        linkedDuringRun = fs.existsSync(link);
        return [];
      },
    });
    await runCommand('all', cfg(), provider, [makeRunner('devin')]);
    assert.equal(linkedDuringRun, true);
    assert.equal(fs.existsSync(link), false);
    assert.equal(fs.existsSync(path.join(repoDir, LOCK_FILENAME)), false);
  });

  it('runCommand cleans links up even when the run throws', async () => {
    const link = path.join(repoDir, '.agents', 'skills', AIDEV_SKILLS_LINK_NAME);
    const provider = makeProvider({ fetchTasks: async () => { throw new Error('provider down'); } });
    await assert.rejects(() => runCommand('all', cfg(), provider, [makeRunner('devin')]), /provider down/);
    assert.equal(fs.existsSync(link), false);
    assert.equal(fs.existsSync(path.join(repoDir, LOCK_FILENAME)), false);
  });

  it('runCommand fails early with a clear message and releases the lock for a missing source', async () => {
    let fetched = false;
    const provider = makeProvider({ fetchTasks: async () => { fetched = true; return []; } });
    const config = { ...cfg(), skillsSource: path.join(tmpDir, 'nope') } as Config;
    await assert.rejects(() => runCommand('all', config, provider, [makeRunner('claude', true)]), /does not exist/);
    assert.equal(fetched, false);
    assert.equal(fs.existsSync(path.join(repoDir, LOCK_FILENAME)), false);
  });
});
