import { Task } from '../types';
import {
  buildThinkingEscalationAnalysisGuidance,
  formatSubtaskId,
  hasThinkingEscalationContext,
  SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX,
  SUBTASK_PROMPT_COMPACT_INSTRUCTIONS_MAX,
  taskDescription,
  truncateForSubtaskPrompt,
} from './shared';
import { SubTask, ThinkingSubtaskPromptOptions, ThinkingTaskPlan } from './types';

export function buildPlanningAnalysisPrompt(task: Task, context: string): string {
  const tagsLine = task.tags.length > 0
    ? `\nParent task tags: ${task.tags.join(', ')}`
    : '';

  return `You are a senior software architect operating in PLANNING MODE. Your job is to break a parent task into a list of fully self-contained sub-task tickets that will be pushed to the task management provider and worked on independently — each by a different agent, in isolation, with NO access to the parent task or to its sibling sub-tasks.

Parent task name: ${task.name}

Parent task description:
${taskDescription(task)}${tagsLine}
${context}

Decide one of:
  (a) If critical information is missing and you cannot produce useful self-contained sub-tasks without it, return a single clarification question.
  (b) Otherwise, return a list of sub-task drafts.

CRITICAL — each sub-task description MUST be fully isolated:
  - Do NOT reference the parent task, sibling sub-tasks, or "the plan".
  - Do NOT use phrases like "as discussed above", "see the parent ticket", "from step 1", or "after the previous sub-task". The agent executing this sub-task will not see any of that.
  - Include every file path, function name, schema, constraint, reasoning, and reference the executing agent will need to complete the work standalone.
  - Restate any shared context (architecture decisions, conventions, motivation) that is required to do the work correctly.
  - Each description should read like its own complete ticket — title, what to change, why, where, and acceptance criteria.

Sub-task priority is optional and uses an integer 1–4 (1 = urgent, 4 = low). Omit the field if you have no opinion.

Sub-task blockers: each sub-task may include an optional "blockedBy" array of 0-based indices into the "subtasks" array, listing sub-tasks that must complete before this one starts. Rules:
  - Only set it when there is a genuine sequential dependency (e.g. a migration must run before the code that uses it).
  - Most sub-tasks should have no blockers — omit the field entirely when not needed.
  - Do not reference a sub-task's own index (no self-blocking).
  - Do not create circular dependencies (if A blocks B, B must not block A).

Respond with valid JSON only — no markdown fences, no extra text:
{
  "clarification": "question text, or null if no clarification is needed",
  "subtasks": [
    {
      "title": "Short, specific title",
      "description": "Fully self-contained ticket body (markdown ok). Include all paths, references, and reasoning needed to do this work without seeing the parent ticket.",
      "priority": 2,
      "blockedBy": [0]
    }
  ]
}

If you set "clarification" to a non-null question, "subtasks" must be an empty array. If you provide sub-tasks, "clarification" must be null.`;
}

export function buildImplementPrompt(task: Task, context: string): string {
  return `You are implementing a software development task. Make the necessary code changes to complete the task described below.

Task: ${task.name}

Description:
${taskDescription(task)}
${context}

Please implement the required changes. Focus on correctness and follow the existing code style in the project.`;
}

export function buildThinkingAnalysisPrompt(task: Task, context: string): string {
  const escalationGuidance = hasThinkingEscalationContext(context)
    ? `\n\n${buildThinkingEscalationAnalysisGuidance()}`
    : '';

  return `You are a senior software architect breaking down a development task into smaller, sequential implementation steps.

Task name: ${task.name}

Description:
${taskDescription(task)}
${context}${escalationGuidance}

Analyze this task and break it into smaller, independently implementable sub-tasks that should be executed sequentially. Each sub-task should be a coherent unit of work that can be committed separately.

CRITICAL: Every sub-task MUST result in actual file modifications (create, edit, or delete files) that can be committed to git. A sub-task that produces no file changes is treated as a failure. Do NOT create sub-tasks that are pure investigation, verification, or read-only steps — for example "check if this folder exists", "review the existing code", "decide on an approach", "verify the build passes", or "run the tests". Any necessary investigation must happen inside a sub-task that also produces concrete file changes (e.g. fold the discovery into the step that applies the resulting edits). Each sub-task's description must name specific files and functions to add, modify, or remove.

Respond with valid JSON only — no markdown fences, no extra text:
{
  "taskSummary": "2-5 short sentences: overall goal and constraints only — for reuse in each sub-task prompt (no step-by-step detail; that goes in instructions and subtasks)",
  "instructions": "Detailed implementation instructions in markdown covering the full task — architecture decisions, key files to modify, edge cases to handle, testing approach",
  "subtasks": [
    {
      "id": 1,
      "title": "Short title for the sub-task",
      "description": "Detailed description of what to implement in this step, including specific files and functions to change. Must describe concrete file modifications."
    }
  ]
}

Keep sub-tasks focused: 2-10 sub-tasks is ideal. Order them by dependency (foundation first).`;
}

export function buildThinkingSubtaskPrompt(
  subtask: SubTask,
  task: Task,
  plan: ThinkingTaskPlan,
  instructions: string,
  reviewContext: string | undefined,
  previousError: string | undefined,
  options: ThinkingSubtaskPromptOptions,
): string {
  const completedSteps = plan.subtasks
    .filter((s) => s.status === 'done')
    .map((s) => `  - [done] ${s.id}. ${s.title}`)
    .join('\n');

  const retrySection = previousError && previousError !== '__git__'
    ? `\n## Previous attempt failure diagnostics\nThis step failed on a previous attempt. Diagnostics below — please take them into account and avoid repeating the same failure.\n\n${previousError}\n`
    : '';

  const { compact } = options;

  let taskContextSection = '';
  if (compact) {
    const summary = plan.taskSummary?.trim();
    if (summary) {
      taskContextSection = `\nGoal (concise):\n${summary}\n`;
    } else if (task.description?.trim()) {
      taskContextSection = `\nTask description (truncated):\n${truncateForSubtaskPrompt(
        task.description.trim(),
        SUBTASK_PROMPT_COMPACT_DESCRIPTION_FALLBACK_MAX,
      )}\n`;
    }
  } else if (task.description?.trim()) {
    taskContextSection = `\nTask description:\n${task.description}\n`;
  }

  let instructionsSection = '';
  const instr = instructions.trim();
  if (compact) {
    if (instr) {
      instructionsSection = `## Implementation plan (truncated)\n${truncateForSubtaskPrompt(
        instr,
        SUBTASK_PROMPT_COMPACT_INSTRUCTIONS_MAX,
      )}\n\n(Full plan: \`${plan.taskId}.aidev.instructions.md\`.)\n`;
    }
  } else if (instr) {
    instructionsSection = `## Full implementation instructions\n${instr}\n`;
  }

  return `You are implementing step ${subtask.id} of a multi-step task.

Overall task: ${task.name}${taskContextSection}
${instructionsSection}${reviewContext || ''}${retrySection}## Progress
${completedSteps || '(no steps completed yet)'}

## Current step: ${subtask.id}. ${subtask.title}
${subtask.description}

Implement ONLY this step. Focus on correctness and follow the existing code style.`;
}

export function buildConflictResolutionPrompt(task: Task, conflictFiles: string[], context: string): string {
  return `You are resolving merge conflicts in a software development task branch.

The task branch has fallen behind the base branch and has merge conflicts that need to be resolved.

## Task context (DO NOT break this — the task must still work after conflict resolution)

Task: ${task.name}

Description:
${taskDescription(task)}
${context}

## Merge conflicts

The following files have merge conflicts with conflict markers (<<<<<<< HEAD, =======, >>>>>>> ...):
${conflictFiles.map((f) => `- ${f}`).join('\n')}

## Instructions

1. Open each conflicting file and resolve the conflict markers
2. Keep BOTH the task's changes AND the base branch updates where possible
3. If the base branch changed something the task also changed, prefer the task's intent but make sure it works with the new base branch code
4. Remove all conflict markers (<<<<<<< HEAD, =======, >>>>>>> ...)
5. Make sure the code compiles and is consistent after resolution
6. Do NOT make any changes beyond what is needed to resolve the conflicts`;
}
