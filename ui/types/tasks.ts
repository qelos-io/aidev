export interface UiTask {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  tags: string[];
  priority?: number;
}

export interface UiComment {
  id: string;
  text: string;
  author: string;
  authorId: string;
  date: number;
}

export interface TasksFilters {
  open: string[];
  pending: string[];
  inProgress: string[];
  review: string[];
  done: string[];
}

export interface TasksResponse {
  filter: string;
  provider: string;
  tasks: UiTask[];
  activeTaskId: string | null;
  filters: TasksFilters;
}

export interface TaskDetailResponse {
  task: UiTask;
  comments: UiComment[];
}

export interface BoardColumn {
  key: string;
  title: string;
  tasks: UiTask[];
}

export interface StatusOption {
  label: string;
  value: string;
}
