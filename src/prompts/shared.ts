import { Task } from '../types';

export function taskDescription(task: Task): string {
  return task.description || '(no description provided)';
}

/** Strips agent meta-instructions and extracts content after `---` when present. */
export function cleanAgentResponseForComment(agentResponse: string): string {
  let cleanedResponse = agentResponse;
  const separatorIndex = agentResponse.indexOf('---');
  if (separatorIndex !== -1) {
    const afterSeparator = agentResponse.substring(separatorIndex + 3).trim();
    const lines = afterSeparator.split('\n');
    const contentStartIndex = lines.findIndex((line) =>
      line.trim() &&
      !line.toLowerCase().includes('here\'s text you can paste') &&
      !line.toLowerCase().includes('task ticket comment') &&
      !line.toLowerCase().includes('addresses your latest ask')
    );
    if (contentStartIndex !== -1) {
      cleanedResponse = lines.slice(contentStartIndex).join('\n').trim();
    }
  }
  return cleanedResponse;
}

export function formatSubtaskId(id: number | string): string {
  return typeof id === 'string' ? id : `${id}.`;
}

/** Max chars for ticket description when compact mode has no {@link ThinkingTaskPlan.taskSummary}. */
export const SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX = 3000;

/** Max chars for archived instructions markdown in compact sub-task prompts. */
export const SUBTASK_PROMPT_COMPACT_INSTRUCTIONS_MAX = 8192;

export function truncateForSubtaskPrompt(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n\n… (truncated)`;
}

export const THINKING_ESCALATION_FAILURE_HEADER = '## Previous direct-run failure';

export function hasThinkingEscalationContext(context: string): boolean {
  return context.includes(THINKING_ESCALATION_FAILURE_HEADER);
}

export function buildThinkingEscalationAnalysisGuidance(): string {
  return `ESCALATION: This task was automatically escalated to thinking mode after all AI runners failed on a direct implementation attempt. The context above includes failure diagnostics and may list uncommitted working-tree changes from that attempt. Account for the prior failure in your breakdown, build on any partial work reflected in uncommitted files, and avoid repeating the same failed approach.`;
}

export function buildThinkingEscalationContext(
  failureDiagnostics: string,
  uncommittedPaths: string[],
): string {
  const sections = [
    THINKING_ESCALATION_FAILURE_HEADER,
    '',
    failureDiagnostics.trim(),
  ];

  if (uncommittedPaths.length > 0) {
    sections.push(
      '',
      '## Uncommitted working-tree changes',
      '',
      'The following files have uncommitted changes from the failed direct run. Account for this partial work in your breakdown:',
      '',
      ...uncommittedPaths.map((filePath) => `- ${filePath}`),
    );
  }

  return sections.join('\n');
}
