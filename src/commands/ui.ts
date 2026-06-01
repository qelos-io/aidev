import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { logger } from '../logger';
import { findBin, isWindows, resolveWindowsCmd } from '../platform';

export interface UICommandOptions {
  port?: string;
  prod?: boolean;
}

const DEFAULT_PORT = 19422;

function resolveUiDir(): string {
  // Walk up from this file to find the repo's ui/ folder. When running from
  // dist/commands/ui.js, __dirname is .../dist/commands; from src it is
  // .../src/commands. Either way, ../../ui resolves to the repo root.
  return path.resolve(__dirname, '..', '..', 'ui');
}

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid --port value: ${raw}`);
  }
  return n;
}

/**
 * Cross-platform spawn for npm/npx-style CLIs. Mirrors the spawnSync wrapper
 * in platform.ts but for the streaming `spawn` API used by long-running procs.
 */
function spawnStreaming(
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2]
) {
  if (!isWindows) {
    return spawn(command, args, options);
  }
  const resolved = /\.(cmd|bat)$/i.test(command) ? command : findBin(command);
  const winCmd = resolveWindowsCmd(resolved, args);
  if (winCmd) {
    return spawn(winCmd.bin, winCmd.args, options);
  }
  return spawn(resolved ?? command, args, options);
}

export async function uiCommand(options: UICommandOptions): Promise<void> {
  const port = parsePort(options.port);
  const uiDir = resolveUiDir();

  if (!fs.existsSync(uiDir)) {
    logger.error(`UI app not found at ${uiDir}. Reinstall @qelos/aidev or check the repo layout.`);
    process.exit(1);
  }

  const outputEntry = path.join(uiDir, '.output', 'server', 'index.mjs');
  const hasBuild = fs.existsSync(outputEntry);
  const hasDevDeps = fs.existsSync(path.join(uiDir, 'node_modules'));

  // Published npm packages ship only ui/.output (see "files" in package.json),
  // so prod mode is the default whenever the build is present. Dev mode is for
  // the source repo and requires ui/node_modules.
  const prodRequested = options.prod === true;
  let useProd: boolean;
  if (prodRequested) {
    if (!hasBuild) {
      logger.error(
        `--prod requested but ${outputEntry} is missing. ` +
          `Build with: cd ${uiDir} && npm run build`
      );
      process.exit(1);
    }
    useProd = true;
  } else if (hasDevDeps) {
    useProd = false;
  } else if (hasBuild) {
    useProd = true;
  } else {
    logger.error(
      `UI is not runnable. Either install dev deps (cd ${uiDir} && npm install) ` +
        `or build the app (cd ${uiDir} && npm run build).`
    );
    process.exit(1);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const loginUrl = `http://127.0.0.1:${port}/login?token=${token}`;

  console.log();
  console.log(chalk.bold('aidev ui'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(`  Mode:     ${useProd ? chalk.cyan('prod') : chalk.cyan('dev')}`);
  console.log(`  Port:     ${chalk.cyan(String(port))}`);
  console.log(`  Login:    ${chalk.green(loginUrl)}`);
  console.log();
  console.log(chalk.dim('  The token is stored in your browser after login.'));
  console.log(chalk.dim('  Press Ctrl+C to stop the server.'));
  console.log();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AIDEV_UI_TOKEN: token,
    AIDEV_UI_PORT: String(port),
    AIDEV_CWD: process.cwd(),
    AIDEV_PACKAGE_DIR: path.resolve(__dirname, '..', '..'),
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(port),
  };

  let child;
  if (useProd) {
    child = spawnStreaming(process.execPath, [outputEntry], {
      cwd: uiDir,
      env,
      stdio: 'inherit',
    });
  } else {
    child = spawnStreaming('npm', ['run', 'dev'], {
      cwd: uiDir,
      env,
      stdio: 'inherit',
    });
  }

  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      logger.error(
        useProd
          ? `Failed to launch node at ${process.execPath}`
          : `Failed to launch npm. Install Node.js / npm and try again.`
      );
    } else {
      logger.error(`Failed to start UI server: ${err.message}`);
    }
    process.exit(1);
  });

  const forwardSignal = (sig: NodeJS.Signals) => {
    if (!child.killed) child.kill(sig);
  };
  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      process.exit(0);
    }
    if (code !== null && code !== 0) {
      logger.error(
        `UI server exited with code ${code}. If port ${port} is already in use, ` +
          `re-run with --port <number>.`
      );
    }
    process.exit(code ?? 0);
  });
}
