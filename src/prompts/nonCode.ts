import { Task } from '../types';
import {
  buildThinkingEscalationAnalysisGuidance,
  formatSubtaskId,
  hasThinkingEscalationContext,
  taskDescription,
} from './shared';
import { NonCodeSubTaskResult, SubTask, ThinkingTaskPlan } from './types';

export function buildNonCodePrompt(task: Task, context: string): string {
  const hasComments = context.trim().length > 0;

  if (hasComments) {
    return `Task: ${task.name}

Original description:
${taskDescription(task)}
${context}

⚠️ CRITICAL: This is a FOLLOW-UP request. The conversation above contains new comments from the user.
YOUR PRIMARY TASK is to address the LATEST comment at the bottom of the conversation - this is the user's current request.
The latest comment may:
- Ask for something completely different from the original task
- Request modifications to what was already done
- Add new requirements

DO NOT repeat what was already done. DO NOT re-execute the original task unless explicitly asked.
Focus ENTIRELY on addressing the latest comment as your main instruction.

Please provide a clear, detailed response to the LATEST comment. Your response will be posted as a comment on the task ticket, so write it as a direct answer or explanation addressed to the person who wrote the latest comment.`;
  }

  return `Task: ${task.name}

Description:
${taskDescription(task)}

Please provide a clear, detailed response to this task. Your response will be posted as a comment on the task ticket, so write it as a direct answer or explanation addressed to the person who created the task.`;
}

export function buildNonCodeAnalysisPrompt(task: Task, context: string): string {
  const escalationGuidance = hasThinkingEscalationContext(context)
    ? `\n\n${buildThinkingEscalationAnalysisGuidance()}`
    : '';

  return `You are a senior analyst breaking down a non-code task (research, investigation, documentation, communication, planning, etc.) into smaller, sequential sub-tasks.

Each sub-task will be executed in order. Each later sub-task will receive a short summary of every earlier sub-task's result, so subsequent steps can build on previous findings.

Task name: ${task.name}

Description:
${taskDescription(task)}
${context}${escalationGuidance}

Analyze this task and break it into 2-8 focused, sequential sub-tasks. Each sub-task should be a coherent unit of work that produces a textual outcome (analysis, summary, draft, list of findings, etc.) — no code changes are expected.

Respond with valid JSON only — no markdown fences, no extra text:
{
  "taskSummary": "2-5 short sentences: overall goal and constraints only — reused as compact context for each sub-task",
  "subtasks": [
    {
      "id": 1,
      "title": "Short title for the sub-task",
      "description": "Detailed description of what to investigate, produce, or decide in this step"
    }
  ]
}

Order sub-tasks by dependency (foundation first). Keep titles short — they will appear in ticket comments.`;
}

export function buildNonCodeSubtaskPrompt(
  subtask: SubTask,
  task: Task,
  plan: ThinkingTaskPlan,
  previousResults: NonCodeSubTaskResult[],
  reviewContext: string | undefined,
): string {
  const completedSteps = plan.subtasks
    .filter((s) => s.status === 'done')
    .map((s) => `  - [done] ${formatSubtaskId(s.id)} ${s.title}`)
    .join('\n');

  const previousSection = previousResults.length > 0
    ? `\n## Summaries from previous sub-tasks\nUse these findings as context — do not repeat work already done.\n\n${previousResults
        .map((r) => `### ${formatSubtaskId(r.id)} ${r.title}\n${r.summary}`)
        .join('\n\n')}\n`
    : '';

  const summary = plan.taskSummary?.trim();
  const goalSection = summary
    ? `\nGoal (concise):\n${summary}\n`
    : task.description?.trim()
      ? `\nTask description:\n${task.description.trim()}\n`
      : '';

  return `You are working on step ${formatSubtaskId(subtask.id)} of a multi-step non-code task. No code changes are expected — produce a clear textual response.

Overall task: ${task.name}${goalSection}${previousSection}${reviewContext || ''}## Progress
${completedSteps || '(no steps completed yet)'}

## Current step: ${formatSubtaskId(subtask.id)} ${subtask.title}
${subtask.description}

Focus ONLY on this step. Write the response so it can be posted directly as a ticket comment — clear, self-contained, and addressed to the task's stakeholders. Do not include preambles like "Here's text you can paste"; output only the content itself.`;
}
