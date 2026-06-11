import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../config';
import { generateFullHooksFile, updateHooksFile } from '../hooksTemplate';
import { logger } from '../logger';
import chalk from 'chalk';

function resolveHooksPath(envPath?: string): string {
  const config = loadConfig(envPath);
  if (!config.hooksPath) {
    throw new Error('AIDEV_HOOKS_PATH is not set. Run "aidev init" or set AIDEV_HOOKS_PATH in .env.aidev');
  }
  return path.isAbsolute(config.hooksPath)
    ? config.hooksPath
    : path.resolve(process.cwd(), config.hooksPath);
}

export function hooksGenerateCommand(opts: { force?: boolean }, envPath?: string): void {
  const hooksPath = resolveHooksPath(envPath);

  if (fs.existsSync(hooksPath) && !opts.force) {
    logger.error(
      `Hooks file already exists: ${hooksPath}\n` +
      `Use ${chalk.cyan('--force')} to overwrite it, or use ${chalk.cyan('aidev hooks update')} to add only missing hooks.`
    );
    process.exit(1);
  }

  const dir = path.dirname(hooksPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(hooksPath, generateFullHooksFile(), 'utf8');
  logger.success(`Hooks file written to ${hooksPath}`);
}

export function hooksUpdateCommand(envPath?: string): void {
  const hooksPath = resolveHooksPath(envPath);

  if (!fs.existsSync(hooksPath)) {
    logger.error(
      `Hooks file not found: ${hooksPath}\n` +
      `Use ${chalk.cyan('aidev hooks generate')} to create it from scratch.`
    );
    process.exit(1);
  }

  const existing = fs.readFileSync(hooksPath, 'utf8');
  const { content, added } = updateHooksFile(existing);

  if (added.length === 0) {
    logger.info('All hooks are already present — nothing to add.');
    return;
  }

  fs.writeFileSync(hooksPath, content, 'utf8');
  logger.success(`Added ${added.length} missing hook(s): ${added.join(', ')}`);
}
