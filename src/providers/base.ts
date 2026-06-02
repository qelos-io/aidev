import {
  Task,
  Comment,
  CreateTaskParams,
  CreateTaskResult,
  DashboardCounts,
  DashboardStatsParams,
  FetchTasksOptions,
} from '../types';

export interface TaskProvider {
  fetchTasks(options?: FetchTasksOptions): Promise<Task[]>;
  fetchTasksByStatus(statuses: string[], options?: FetchTasksOptions): Promise<Task[]>;
  /**
   * Single-task fetch for dashboards. Optional — callers fall back to list scans.
   */
  fetchTaskById?(taskId: string, options?: FetchTasksOptions): Promise<Task | null>;
  /**
   * One round-trip board listing (open + pending + in progress). Optional.
   */
  fetchBoardTasks?(options?: FetchTasksOptions): Promise<Task[]>;
  /**
   * Fast path for dashboard stats — providers may use filtered/paginated API
   * queries instead of repeated full task list scans.
   */
  fetchDashboardCounts?(params: DashboardStatsParams): Promise<DashboardCounts>;
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
  /**
   * Removes a tag/label from a task. Optional — providers that don't expose
   * tag mutation can omit it; callers must guard with a typeof check.
   */
  removeTag?(taskId: string, tag: string): Promise<void>;
  /**
   * Adds a tag/label to a task. Optional — same guard as removeTag.
   */
  addTag?(taskId: string, tag: string): Promise<void>;
}
