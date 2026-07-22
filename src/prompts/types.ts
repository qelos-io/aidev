export interface SubTask {
  id: number | string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  lastError?: string;
}

export interface ThinkingTaskPlan {
  taskId: string;
  taskName: string;
  /** Short summary of the ticket goal for compact sub-task prompts (from analyze step). */
  taskSummary?: string;
  subtasks: SubTask[];
}

export interface NonCodeSubTaskResult {
  id: number | string;
  title: string;
  summary: string;
}

export interface ThinkingSubtaskPromptOptions {
  /** Smaller prompt: concise goal + truncated plan; used when there are no human ticket comments or on AI retry. */
  compact: boolean;
}

export interface PlanningSubtaskDraft {
  title: string;
  description: string;
  priority?: number;
  blockedBy?: number[];
}

export interface PlanningAnalysisResponse {
  clarification?: string;
  subtasks: PlanningSubtaskDraft[];
}

export interface ThinkingAnalysisDraft {
  taskSummary?: string;
  instructions?: string;
  subtasks: Array<{ id?: number | string; title: string; description: string }>;
}
