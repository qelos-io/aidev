export interface AIRunResult {
  success: boolean;
  output: string;
  error: string;
}

export interface AIRunner {
  name: string;
  isAvailable(): boolean;
  run(prompt: string, notes?: string): Promise<AIRunResult>;
}
