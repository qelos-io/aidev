import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  commandExists,
  findBin,
  spawnCommand,
  resolveWindowsCmd,
  parseCmdShimTarget,
  isWindows,
  shouldRetryAgentCliAttempt,
} from '../platform';

const FAKE = '__aidev_definitely_not_a_real_binary_xyz__';

describe('commandExists', () => {
  it('returns true for node (always in PATH when tests run)', () => {
    assert.equal(commandExists('node'), true);
  });

  it('returns false for a non-existent binary', () => {
    assert.equal(commandExists(FAKE), false);
  });
});

describe('shouldRetryAgentCliAttempt', () => {
  it('returns true for unknown option style stderr', () => {
    assert.equal(shouldRetryAgentCliAttempt('error: unknown option --foo', ''), true);
  });

  it('returns true for Cursor-style invalid model message', () => {
    assert.equal(
      shouldRetryAgentCliAttempt(
        "There's an issue with the selected model (auto). It may not exist or you may not have access to it.",
        ''
      ),
      true
    );
  });

  it('returns false for unrelated stderr', () => {
    assert.equal(shouldRetryAgentCliAttempt('build failed: syntax error', ''), false);
  });
});

describe('findBin', () => {
  it('returns a non-null path for node', () => {
    const result = findBin('node');
    assert.notEqual(result, null);
  });

  it('returned path contains "node"', () => {
    const result = findBin('node');
    assert.ok(result?.toLowerCase().includes('node'));
  });

  it('returns null for a non-existent binary', () => {
    assert.equal(findBin(FAKE), null);
  });
});

describe('spawnCommand', () => {
  it('runs a command and returns stdout', () => {
    const result = spawnCommand('node', ['--version'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.startsWith('v'));
  });

  it('returns non-zero status for invalid args', () => {
    const result = spawnCommand('node', ['--invalid-flag-xyz'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  });

  it('passes through spawn errors for non-existent commands', () => {
    const result = spawnCommand(FAKE, ['--version'], { encoding: 'utf8' });
    assert.ok(result.error);
  });
});

// ─── parseCmdShimTarget ──────────────────────────────────────────────────────

describe('parseCmdShimTarget', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-platform-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts script path from standard npm .cmd shim (%dp0%)', () => {
    // Create the target script
    const nmDir = path.join(tmpDir, 'node_modules', '@anthropic-ai', 'claude-code');
    fs.mkdirSync(nmDir, { recursive: true });
    const scriptPath = path.join(nmDir, 'cli.js');
    fs.writeFileSync(scriptPath, '// cli', 'utf8');

    const relScript = path.relative(tmpDir, scriptPath);
    const cmdContent = [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relScript}" %*`,
    ].join('\r\n');

    const cmdPath = path.join(tmpDir, 'claude.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');

    const result = parseCmdShimTarget(cmdPath);
    assert.equal(result, scriptPath);
  });

  it('extracts script path from shim using %~dp0 prefix', () => {
    const nmDir = path.join(tmpDir, 'node_modules', '.bin');
    fs.mkdirSync(nmDir, { recursive: true });
    const scriptPath = path.join(nmDir, 'agent.js');
    fs.writeFileSync(scriptPath, '// agent', 'utf8');

    const relScript = path.relative(tmpDir, scriptPath);
    const cmdContent = `@ECHO off\r\n"%~dp0\\${relScript}" %*\r\n`;

    const cmdPath = path.join(tmpDir, 'agent.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');

    const result = parseCmdShimTarget(cmdPath);
    assert.equal(result, scriptPath);
  });

  it('returns null when script file does not exist on disk', () => {
    const cmdContent = [
      '@ECHO off',
      'endLocal & "%_prog%"  "%dp0%\\node_modules\\missing\\cli.js" %*',
    ].join('\r\n');

    const cmdPath = path.join(tmpDir, 'missing.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');

    const result = parseCmdShimTarget(cmdPath);
    assert.equal(result, null);
  });

  it('returns null for non-npm .cmd files without a JS target', () => {
    const cmdContent = '@ECHO off\r\nsome-native.exe %*\r\n';
    const cmdPath = path.join(tmpDir, 'native.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');

    const result = parseCmdShimTarget(cmdPath);
    assert.equal(result, null);
  });

  it('returns null for non-existent file', () => {
    const result = parseCmdShimTarget(path.join(tmpDir, 'nope.cmd'));
    assert.equal(result, null);
  });

  it('extracts .mjs target scripts', () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'pkg');
    fs.mkdirSync(nmDir, { recursive: true });
    const scriptPath = path.join(nmDir, 'cli.mjs');
    fs.writeFileSync(scriptPath, '// mjs', 'utf8');

    const relScript = path.relative(tmpDir, scriptPath);
    const cmdContent = `@ECHO off\r\n"%~dp0\\${relScript}" %*\r\n`;
    const cmdPath = path.join(tmpDir, 'pkg.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');

    const result = parseCmdShimTarget(cmdPath);
    assert.equal(result, scriptPath);
  });
});

// ─── resolveWindowsCmd ────────────────────────────────────────────────────────

describe('resolveWindowsCmd', () => {
  let origComSpec: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    origComSpec = process.env.ComSpec;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-resolve-test-'));
  });

  afterEach(() => {
    if (origComSpec !== undefined) process.env.ComSpec = origComSpec;
    else delete process.env.ComSpec;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('spawns node.exe directly when .cmd shim has a parseable JS target', () => {
    // Create a realistic npm shim with a real JS target
    const nmDir = path.join(tmpDir, 'node_modules', '@anthropic-ai', 'claude-code');
    fs.mkdirSync(nmDir, { recursive: true });
    const scriptPath = path.join(nmDir, 'cli.js');
    fs.writeFileSync(scriptPath, '// cli', 'utf8');

    const relScript = path.relative(tmpDir, scriptPath);
    const cmdContent = `@ECHO off\r\n"%~dp0\\${relScript}" %*\r\n`;
    const cmdPath = path.join(tmpDir, 'claude.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');

    const prompt = 'Implement feature: use & and | operators in <template>';
    const result = resolveWindowsCmd(cmdPath, ['-p', prompt, '--dangerously-skip-permissions']);

    assert.notEqual(result, null);
    // Should use node.exe, NOT cmd.exe
    assert.ok(
      result!.bin.toLowerCase().includes('node'),
      `Expected node.exe but got: ${result!.bin}`
    );
    // First arg is the script, then the original args
    assert.equal(result!.args[0], scriptPath);
    assert.equal(result!.args[1], '-p');
    assert.equal(result!.args[2], prompt);
  });

  it('falls back to cmd.exe /c for non-parseable .cmd files', () => {
    const cmdContent = '@ECHO off\r\nsome-native.exe %*\r\n';
    const cmdPath = path.join(tmpDir, 'native.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');

    const result = resolveWindowsCmd(cmdPath, ['arg1']);
    assert.notEqual(result, null);
    assert.deepEqual(result!.args, ['/c', cmdPath, 'arg1']);
  });

  it('falls back to cmd.exe /c for .bat files', () => {
    const cmdPath = path.join(tmpDir, 'run.bat');
    fs.writeFileSync(cmdPath, '@ECHO off\r\nrun.exe %*\r\n', 'utf8');

    const result = resolveWindowsCmd(cmdPath, ['arg1', 'arg2']);
    assert.notEqual(result, null);
    assert.deepEqual(result!.args, ['/c', cmdPath, 'arg1', 'arg2']);
  });

  it('returns null for .exe files', () => {
    assert.equal(resolveWindowsCmd('C:\\node\\node.exe', ['--version']), null);
  });

  it('returns null for null path', () => {
    assert.equal(resolveWindowsCmd(null, ['--version']), null);
  });

  it('returns null for paths without extension', () => {
    assert.equal(resolveWindowsCmd('/usr/local/bin/claude', ['-p', 'test']), null);
  });

  it('uses ComSpec env var for fallback when set', () => {
    process.env.ComSpec = 'C:\\custom\\cmd.exe';
    // Non-parseable .cmd → falls back to cmd.exe
    const cmdPath = path.join(tmpDir, 'tool.cmd');
    fs.writeFileSync(cmdPath, '@ECHO off\r\ntool.exe %*\r\n', 'utf8');

    const result = resolveWindowsCmd(cmdPath, []);
    assert.equal(result!.bin, 'C:\\custom\\cmd.exe');
  });

  it('defaults to cmd.exe when ComSpec is not set (fallback path)', () => {
    delete process.env.ComSpec;
    const cmdPath = path.join(tmpDir, 'tool.cmd');
    fs.writeFileSync(cmdPath, '@ECHO off\r\ntool.exe %*\r\n', 'utf8');

    const result = resolveWindowsCmd(cmdPath, []);
    assert.equal(result!.bin, 'cmd.exe');
  });

  it('preserves argument order including prompt with special chars', () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'cli');
    fs.mkdirSync(nmDir, { recursive: true });
    const scriptPath = path.join(nmDir, 'index.js');
    fs.writeFileSync(scriptPath, '// index', 'utf8');

    const relScript = path.relative(tmpDir, scriptPath);
    const cmdContent = `@ECHO off\r\n"%~dp0\\${relScript}" %*\r\n`;
    const cmdPath = path.join(tmpDir, 'cli.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');

    const prompt = 'Fix the bug: if (a && b) { return c | d; }';
    const result = resolveWindowsCmd(cmdPath, ['-p', prompt, '--flag']);
    assert.deepEqual(result!.args, [scriptPath, '-p', prompt, '--flag']);
  });

  it('handles empty args array', () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'cli');
    fs.mkdirSync(nmDir, { recursive: true });
    const scriptPath = path.join(nmDir, 'index.js');
    fs.writeFileSync(scriptPath, '// index', 'utf8');

    const relScript = path.relative(tmpDir, scriptPath);
    const cmdContent = `@ECHO off\r\n"%~dp0\\${relScript}" %*\r\n`;
    const cmdPath = path.join(tmpDir, 'cli.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');

    const result = resolveWindowsCmd(cmdPath, []);
    assert.deepEqual(result!.args, [scriptPath]);
  });
});

// ─── Windows integration: spawnCommand through .cmd shim ──────────────────────

describe('spawnCommand via .cmd shim (Windows integration)', { skip: !isWindows }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidev-spawn-shim-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Creates a .cmd shim that wraps a tiny Node.js script, mimicking how
   * npm-installed CLIs work on Windows.
   */
  function createShimmedScript(scriptBody: string): string {
    const nmDir = path.join(tmpDir, 'node_modules', 'test-cli');
    fs.mkdirSync(nmDir, { recursive: true });
    const scriptPath = path.join(nmDir, 'cli.js');
    fs.writeFileSync(scriptPath, scriptBody, 'utf8');

    const relScript = path.relative(tmpDir, scriptPath);
    const cmdContent = [
      '@ECHO off',
      `"${process.execPath}"  "%~dp0\\${relScript}" %*`,
    ].join('\r\n');
    const cmdPath = path.join(tmpDir, 'test-cli.cmd');
    fs.writeFileSync(cmdPath, cmdContent, 'utf8');
    return cmdPath;
  }

  it('passes arguments with shell metacharacters intact', () => {
    // Script echoes its argv as JSON
    const cmdPath = createShimmedScript(
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));'
    );

    const prompt = 'if (a && b) { return c | d; } // <check> "quoted" %var%';
    const result = spawnCommand(cmdPath, ['-p', prompt, '--flag'], { encoding: 'utf8' });

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const argv = JSON.parse(result.stdout);
    assert.deepEqual(argv, ['-p', prompt, '--flag']);
  });

  it('forwards stdin to the child process', () => {
    // Script reads stdin and echoes it back
    const cmdPath = createShimmedScript(`
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => { process.stdout.write(data); });
    `);

    const stdinContent = 'Implement: use & and | operators\nLine 2: <html>';
    const result = spawnCommand(cmdPath, [], { encoding: 'utf8', input: stdinContent });

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stdout, stdinContent);
  });

  it('handles very long prompts (>8KB, beyond cmd.exe limit)', () => {
    const cmdPath = createShimmedScript(
      'process.stdout.write(String(process.argv[2].length));'
    );

    // 10KB prompt — exceeds cmd.exe's ~8191 char command line limit
    const longPrompt = 'A'.repeat(10000);
    const result = spawnCommand(cmdPath, [longPrompt], { encoding: 'utf8' });

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stdout.trim(), '10000');
  });
});
