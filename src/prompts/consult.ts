import { Task } from '../types';
import { taskDescription } from './shared';

export function buildConsultPrompt(task: Task, context: string): string {
  const hasComments = context.trim().length > 0;

  if (hasComments) {
    return `Task: ${task.name}

Original description:
${taskDescription(task)}
${context}

You are responding as a **consultation agent** on another project's ticket. Share your perspective from this codebase — do not fix upstream code or run the full SDLC.

⚠️ CRITICAL: Address the LATEST comment at the bottom of the conversation.
Write a direct reply that will be posted on the ticket. Do not declare the overall task complete.`;
  }

  return `Task: ${task.name}

Description:
${taskDescription(task)}

You are responding as a **consultation agent** on another project's ticket. Share your perspective from this codebase. Write a direct reply for the ticket. Do not declare the overall task complete.`;
}
