import { Task, Comment, CreateTaskParams, CreateTaskResult } from '../types';

export interface TaskProvider {
  fetchTasks(): Promise<Task[]>;
  postComment(taskId: string, text: string): Promise<void>;
  getComments(taskId: string): Promise<Comment[]>;
  updateStatus(taskId: string, status: string): Promise<void>;
  createTask(params: CreateTaskParams): Promise<CreateTaskResult>;
}
