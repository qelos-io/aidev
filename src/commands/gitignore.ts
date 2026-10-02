import { ensureGitignore, getAidevGitignorePatterns, getMissingGitignorePatterns } from './init';
import { logger } from '../logger';

/** Prints every pattern aidev expects in .gitignore, one per line (pipe-friendly). */
export function gitignoreGetCommand(): void {
  for (const pattern of getAidevGitignorePatterns()) {
    console.log(pattern);
  }
}

/** Inserts the aidev patterns missing from the existing .gitignore. */
export function gitignoreModifyCommand(dir = process.cwd()): void {
  if (getMissingGitignorePatterns(dir).length === 0) {
    logger.info('.gitignore already contains all aidev patterns');
  }
  ensureGitignore(dir);
}
