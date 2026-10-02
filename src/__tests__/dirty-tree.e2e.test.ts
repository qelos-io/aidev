import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// E2E regression: a repo using aidev has stray uncommitted aidev bookkeeping
// files (e.g. `.aidev/last-cleanup.json`). The next `aidev run` with at least
// one open task must still create the task branch instead of failing in git.ts.

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'src', 'cli.ts');

function sh(cmd: string, args: string[], cwd: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

describe('aidev run with stray uncommitted files (e2e, local provider)', () => {
  let work: string;
  let bare: string;
  let binDir: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-e2e-work-'));
    bare = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-e2e-bare-'));
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-e2e-bin-'));

    sh('git', ['init', '--bare', '-b', 'main'], bare);
    sh('git', ['init', '-b', 'main'], work);
    sh('git', ['config', 'user.email', 't@t.t'], work);
    sh('git', ['config', 'user.name', 't'], work);
    sh('git', ['remote', 'add', 'origin', bare], work);

    fs.writeFileSync(path.join(work, '.env.aidev'), 'PROVIDER=local\nAI_TOOL=claude\nGIT_REMOTE=origin\nGITHUB_BASE_BRANCH=main\n');
    fs.writeFileSync(path.join(work, '.gitignore'), '.env.aidev\naidev.log\n.aidev/tasks/\n.aidev/mcp/\n.aidev/sessions/\n.aidev/assets/\n');
    fs.writeFileSync(path.join(work, 'README.md'), '# repo\n');
    sh('git', ['add', '-A'], work);
    sh('git', ['commit', '-m', 'init'], work);
    sh('git', ['push', '-u', 'origin', 'main'], work);

    // One open local task.
    const openDir = path.join(work, '.aidev', 'tasks', 'open');
    fs.mkdirSync(openDir, { recursive: true });
    fs.writeFileSync(path.join(openDir, 'abc12345-add-feature.md'), '---\nname: Add feature\n---\n\nImplement the feature.\n');

    // Fake `claude` CLI: answers JSON-only prompts (clarity check) as "clear",
    // and makes a file change for the implementation prompt.
    const fake = path.join(binDir, 'claude');
    fs.writeFileSync(
      fake,
      '#!/bin/sh\ncase "$2" in\n  *"Respond with valid JSON only"*) echo \'{"clear":true,"question":null}\';;\n  *) echo feature > feature.txt; echo done;;\nesac\nexit 0\n',
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    for (const d of [work, bare, binDir]) fs.rmSync(d, { recursive: true, force: true });
  });

  function runAidev(): string {
    const r = spawnSync(process.execPath, ['--require', require.resolve('tsx/cjs'), cliPath, 'run'], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, NO_COLOR: '1' },
      timeout: 60000,
    });
    return `${r.stdout}\n${r.stderr}`;
  }

  function writeLegacyState(): string {
    fs.mkdirSync(path.join(work, '.aidev'), { recursive: true });
    const file = path.join(work, '.aidev', 'last-cleanup.json');
    fs.writeFileSync(file, JSON.stringify({ lastCleanupAt: 1 }));
    return file;
  }

  function assertTaskBranchCreated(output: string): void {
    assert.doesNotMatch(output, /Cannot create branch|working tree has uncommitted changes/, output);
    assert.doesNotMatch(output, /Failed to create branch/, output);
    const branches = sh('git', ['branch', '--format=%(refname:short)'], work);
    assert.match(branches, /abc12345/, `expected a task branch, got:\n${branches}\n${output}`);
    const branch = branches.split('\n').find((b) => b.includes('abc12345'))!.trim();
    const changed = sh('git', ['diff', '--name-only', `main..${branch}`], work);
    assert.doesNotMatch(changed, /last-cleanup/, `legacy state leaked into the task branch:\n${changed}`);
  }

  it('creates the task branch even when .aidev/last-cleanup.json is untracked', () => {
    writeLegacyState();
    assertTaskBranchCreated(runAidev());
  });

  it('creates the task branch when a legacy last-cleanup.json is tracked and modified', () => {
    const file = writeLegacyState();
    sh('git', ['add', '-f', '.aidev/last-cleanup.json'], work);
    sh('git', ['commit', '-m', 'legacy state'], work);
    sh('git', ['push', 'origin', 'main'], work);
    fs.writeFileSync(file, JSON.stringify({ lastCleanupAt: 2 }));

    assertTaskBranchCreated(runAidev());
  });
});
