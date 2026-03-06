import { Task, Comment } from '../types';

export interface TaskProvider {
  fetchTasks(): Promise<Task[]>;
  postComment(taskId: string, text: string): Promise<void>;
  getComments(taskId: string): Promise<Comment[]>;
  updateStatus(taskId: string, status: string): Promise<void>;
}
