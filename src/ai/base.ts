export interface AIRunOptions {
  signal?: AbortSignal;
  assetDirs?: string[];
}

export interface AIRunResult {
  success: boolean;
  output: string;
  error: string;
  aborted?: boolean;
}

export interface AIRunner {
  name: string;
  isAvailable(): boolean;
  run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult>;
}
