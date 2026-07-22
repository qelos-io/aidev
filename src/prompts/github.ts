import { Config, Task } from '../types';

export function buildPRBody(task: Task): string {
  const signature = process.env.PR_SIGNATURE || 'Automated PR by aidev.';
  return `Implements: ${task.url}\n\n${signature}`;
}

export function buildPRUrl(config: Config, branch: string): string {
  if (!config.githubRepo) return '';
  const encoded = encodeURIComponent(branch);
  return `https://github.com/${config.githubRepo}/compare/${config.githubBaseBranch}...${encoded}?expand=1`;
}
