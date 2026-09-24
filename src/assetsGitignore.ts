import * as fs from 'node:fs';
import * as path from 'node:path';
import { assetsRootRelPath } from './aidevAssets';
import { ensureGitignore, isAidevAssetsGitignored } from './commands/init';
import * as git from './git';
import { logger } from './logger';

const ASSETS_GIT_PREFIX = '.aidev/assets/';

export interface AidevAssetsGitignoreState {
  missingGitignore: boolean;
  indexedFiles: string[];
}

export function detectAidevAssetsGitignoreIssues(cwd = process.cwd()): AidevAssetsGitignoreState {
  return {
    missingGitignore: !isAidevAssetsGitignored(cwd),
    indexedFiles: git.listIndexedPaths(ASSETS_GIT_PREFIX, cwd),
  };
}

export function hasAidevAssetsGitignoreIssues(state: AidevAssetsGitignoreState): boolean {
  return state.missingGitignore || state.indexedFiles.length > 0;
}

/**
 * Before task commits, ensure `.aidev/assets/` stays git-ignored and is not indexed,
 * and that every aidev-managed pattern (including MCP files) is present in
 * `.gitignore` and committed. Remediates violations by removing the folder,
 * committing removal when needed, and committing a `.gitignore` update.
 *
 * The `.gitignore` update runs unconditionally as a safety net: `cli.ts`
 * already commits any `.gitignore` changes left by `materializeMcp()` on the
 * base branch immediately (aidev never stashes, so `createBranchFromRemote`
 * requires a clean tree), but other cases — e.g. a locally-edited
 * `.gitignore` or indexed asset files — can still leave `.gitignore` out of
 * sync on the task branch, so it's re-verified and committed here too.
 */
export function prepareForTaskCommit(
  branchName: string,
  commitPrefix: string,
  cwd = process.cwd(),
): boolean {
  const state = detectAidevAssetsGitignoreIssues(cwd);
  const hasAssetsIssues = hasAidevAssetsGitignoreIssues(state);

  if (hasAssetsIssues) {
    logger.warn(
      '.aidev/assets must remain git-ignored — removing assets and updating .gitignore'
    );

    const assetsDir = path.join(cwd, assetsRootRelPath());
    const hadIndexedFiles = state.indexedFiles.length > 0;

    if (hadIndexedFiles) {
      if (!git.removePathFromIndexAndTree(ASSETS_GIT_PREFIX.replace(/\/$/, ''), cwd)) {
        return false;
      }
      if (!git.commit(
        `${commitPrefix} Remove .aidev/assets from repository\n\nTask asset downloads must remain git-ignored.`,
        branchName,
      )) {
        logger.error('Failed to commit .aidev/assets removal');
        return false;
      }
    } else if (fs.existsSync(assetsDir)) {
      fs.rmSync(assetsDir, { recursive: true, force: true });
    }
  }

  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignoreBefore = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';

  ensureGitignore(cwd);

  const gitignoreAfter = fs.readFileSync(gitignorePath, 'utf8');
  if (gitignoreBefore !== gitignoreAfter) {
    if (!git.addPath('.gitignore', cwd)) {
      logger.error('Failed to stage .gitignore update');
      return false;
    }
    const message = hasAssetsIssues
      ? `${commitPrefix} Ignore .aidev/assets/\n\nEnsure task asset downloads are never committed.`
      : `${commitPrefix} Update .gitignore\n\nEnsure aidev-managed files are git-ignored.`;
    if (!git.commit(message, branchName)) {
      logger.error('Failed to commit .gitignore update');
      return false;
    }
  }

  return true;
}
