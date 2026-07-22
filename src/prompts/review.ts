import { Task } from '../types';
import { ReviewThread } from '../github';
import { taskDescription } from './shared';

const REPLY_REGEX = /<!-- AIDEV-REPLY ([\w=+/]+) -->([\s\S]*?)<!-- \/AIDEV-REPLY -->/g;

export function parseReplyDirectives(output: string): Array<{ threadId: string; body: string }> {
  const replies: Array<{ threadId: string; body: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = REPLY_REGEX.exec(output)) !== null) {
    replies.push({ threadId: match[1], body: match[2].trim() });
  }
  return replies;
}

export function buildReviewPrompt(task: Task, threads: ReviewThread[]): string {
  let prompt = `You are addressing code review comments on a pull request for a software development task.

Task: ${task.name}

Description:
${taskDescription(task)}

## Unresolved Code Review Threads

The following review threads need to be addressed. For each thread, either:
- Fix the code as requested (make the changes directly in the files)
- Or, if it's a discussion/question that doesn't require code changes, output a REPLY block:
  <!-- AIDEV-REPLY thread_id -->Your reply here<!-- /AIDEV-REPLY -->

Replace "thread_id" with the actual thread ID shown below.

`;

  for (const thread of threads) {
    const location = thread.line
      ? `\`${thread.path}\` (line ${thread.line})`
      : `\`${thread.path}\``;
    prompt += `### Thread ${thread.id} — ${location}\n`;
    for (const comment of thread.comments) {
      prompt += `> **${comment.author}**: ${comment.body}\n`;
    }
    prompt += '\n';
  }

  prompt += `## Instructions

1. Read each review thread carefully
2. For code change requests: make the fix directly in the relevant file(s)
3. For questions or discussions: output a REPLY block with a clear, helpful response
4. You may handle multiple threads — some with code fixes, others with replies
5. Focus on correctness and follow the existing code style`;

  return prompt;
}
