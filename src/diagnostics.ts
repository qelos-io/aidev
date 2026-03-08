import { spawnSync } from 'node:child_process';
import { logger } from './logger';

interface ToolInfo {
  name: string;
  available: boolean;
  version: string | null;
}

interface DiagnosticReport {
  tools: ToolInfo[];
  gitBranch: string | null;
  gitStatus: string;
}

const TOOLS_TO_CHECK: Array<{ name: string; versionArgs: string[] }> = [
  { name: 'git', versionArgs: ['--version'] },
  { name: 'gh', versionArgs: ['--version'] },
  { name: 'node', versionArgs: ['--version'] },
  { name: 'cursor', versionArgs: ['--version'] },
  { name: 'claude', versionArgs: ['--version'] },
  { name: 'windsurf', versionArgs: ['--version'] },
];

function getToolVersion(name: string, versionArgs: string[]): ToolInfo {
  try {
    const result = spawnSync(name, versionArgs, {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (result.status === 0 && result.stdout) {
      return { name, available: true, version: result.stdout.trim().split('\n')[0] };
    }
    if (result.error) {
      return { name, available: false, version: null };
    }
    return { name, available: true, version: result.stderr?.trim().split('\n')[0] || 'unknown' };
  } catch {
    return { name, available: false, version: null };
  }
}

function getGitBranch(): string | null {
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

function getGitStatus(): string {
  try {
    const result = spawnSync('git', ['status', '--short'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return result.status === 0 ? result.stdout.trim() : '(unable to retrieve git status)';
  } catch {
    return '(unable to retrieve git status)';
  }
}

function collectReport(): DiagnosticReport {
  const tools = TOOLS_TO_CHECK.map((t) => getToolVersion(t.name, t.versionArgs));
  return {
    tools,
    gitBranch: getGitBranch(),
    gitStatus: getGitStatus(),
  };
}

export function formatDiagnosticReport(report: DiagnosticReport): string {
  const lines: string[] = ['--- Environment Diagnostic Report ---'];

  lines.push('');
  lines.push('Tools:');
  for (const tool of report.tools) {
    const status = tool.available
      ? `✓ ${tool.version}`
      : '✗ not found';
    lines.push(`  ${tool.name}: ${status}`);
  }

  lines.push('');
  lines.push(`Git branch: ${report.gitBranch ?? '(detached or unknown)'}`);
  lines.push(`Git status:\n${report.gitStatus || '(clean)'}`);

  lines.push('--- End Diagnostic Report ---');
  return lines.join('\n');
}

export function collectAndLogDiagnostics(): string {
  const report = collectReport();
  const formatted = formatDiagnosticReport(report);
  for (const line of formatted.split('\n')) {
    logger.info(line);
  }
  return formatted;
}
