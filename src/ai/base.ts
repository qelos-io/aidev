/**
 * A conversation session shared across several `run()` calls so a follow-up
 * prompt sees the full context of the first one. `id` is an aidev-generated
 * UUID; runners map it onto whatever their CLI supports (a custom session id,
 * a "continue last session" flag, a per-session chat-history file, ...).
 */
export interface AISessionOptions {
  id: string;
  /** false = start the session, true = continue the session started earlier. */
  resume: boolean;
}

export interface AIRunOptions {
  signal?: AbortSignal;
  assetDirs?: string[];
  session?: AISessionOptions;
}

export interface AIRunResult {
  success: boolean;
  output: string;
  error: string;
  aborted?: boolean;
}

export interface AIRunner {
  name: string;
  /** True when the runner honours `AIRunOptions.session` (follow-up prompts in the same conversation). */
  supportsSessions?: boolean;
  isAvailable(): boolean;
  run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult>;
}
