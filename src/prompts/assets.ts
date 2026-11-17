import * as fs from 'node:fs';
import * as path from 'node:path';
import { listTaskAssetFiles } from '../aidevAssets';
import { secretsFilePath, secretsFileRelPath } from '../safeMode';

export interface AssetsAccessInstructionsOptions {
  assetFiles?: string[];
  secretsRelPath?: string;
}

export function buildAssetsAccessInstructions(
  taskId: string,
  cwd = process.cwd(),
  options?: AssetsAccessInstructionsOptions
): string {
  const assetFiles = options?.assetFiles ?? listTaskAssetFiles(taskId, cwd);
  const secretsRelPath = resolveSecretsRelPath(taskId, cwd, options?.secretsRelPath);

  if (assetFiles.length === 0 && !secretsRelPath) {
    return '';
  }

  const lines: string[] = ['', '## Aidev task assets', ''];

  if (assetFiles.length > 0) {
    lines.push(
      'The following attachment files are available under `.aidev/assets/` (git-ignored but you may access them):',
      ''
    );
    for (const file of assetFiles) {
      lines.push(`- \`${file}\``);
    }
    lines.push(
      '',
      'You may read these files and copy them into the project as needed (e.g. logos → `public/`).'
    );
  }

  if (secretsRelPath) {
    if (assetFiles.length > 0) {
      lines.push('');
    }
    lines.push(buildSecretsAccessNotice(secretsRelPath));
  }

  return lines.join('\n');
}

export type SavedDiffOutcome = 'applied' | 'conflicts' | 'failed';

/**
 * Prompt/context note about the `uncommitted.diff` snapshot left by a previous
 * failed attempt, describing whether it was re-applied to the working tree.
 */
export function buildSavedDiffNotice(outcome: SavedDiffOutcome, diffRelPath: string, error?: string): string {
  const lines: string[] = ['', '## Changes from the previous failed attempt', ''];
  if (outcome === 'applied') {
    lines.push(
      'A previous attempt on this task failed and left uncommitted changes. They were re-applied to the working tree ' +
        '(staged, not committed). Review them, keep what is correct, and build on them rather than starting over.'
    );
  } else if (outcome === 'conflicts') {
    lines.push(
      'A previous attempt on this task failed and left uncommitted changes. They were re-applied with merge conflicts: ' +
        'look for conflict markers (`<<<<<<<`) in the working tree and resolve them before continuing.'
    );
  } else {
    lines.push(
      'A previous attempt on this task failed and left uncommitted changes, but they could not be re-applied automatically' +
        (error ? ` (${error.split('\n')[0]})` : '') +
        `. The patch is saved at \`${diffRelPath}\` (git-ignored). Inspect it and, if useful, apply the relevant parts ` +
        'manually (e.g. `git apply --3way`).'
    );
  }
  return lines.join('\n');
}

function resolveSecretsRelPath(
  taskId: string,
  cwd: string,
  explicitRelPath: string | undefined
): string | undefined {
  if (explicitRelPath !== undefined) {
    return explicitRelPath || undefined;
  }

  const secretsPath = secretsFilePath(taskId, cwd);
  if (!fs.existsSync(secretsPath)) {
    return undefined;
  }

  return secretsFileRelPath(taskId).split(path.sep).join('/');
}

function buildSecretsAccessNotice(relPath: string): string {
  return (
    `⚠️ Secret values were redacted from this prompt. ` +
    `They are stored in \`${relPath}\` (git-ignored). ` +
    `That file is available for shell workflows, but do not read it into context — ` +
    `avoid the Read tool on \`*.secrets\` files and do not paste their contents into chat. ` +
    `Prefer \`ls\`, \`grep\`, or piping values via the terminal instead of reading that file directly.`
  );
}
