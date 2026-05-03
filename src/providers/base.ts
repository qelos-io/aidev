import { Task, Comment, CreateTaskParams, CreateTaskResult } from '../types';

export interface TaskProvider {
  fetchTasks(): Promise<Task[]>;
  fetchTasksByStatus(statuses: string[]): Promise<Task[]>;
  postComment(taskId: string, text: string): Promise<void>;
  getComments(taskId: string): Promise<Comment[]>;
  updateStatus(taskId: string, status: string): Promise<void>;
  createTask(params: CreateTaskParams): Promise<CreateTaskResult>;
  /**
   * Returns the list of status names available on the board / project. Used to
   * auto-detect a "done" status when the user has not configured one. Optional
   * because not every backend exposes this cleanly; callers must handle absence.
   */
  fetchAvailableStatuses?(): Promise<string[]>;
}
