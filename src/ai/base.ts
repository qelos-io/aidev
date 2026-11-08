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

/**
 * External, read-only skills/rules source (resolved once per `aidev run`).
 * Runners that can take external paths on their CLI use it directly; the rest
 * rely on the symlink fallback (see `AIRunner.supportsExternalContext`).
 */
export interface AIExtraContext {
  rootDir: string;
  skillsDir?: string;
  rulesDir?: string;
  agentsDir?: string;
}

export interface AIRunOptions {
  extraContext?: AIExtraContext;
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
  /**
   * True when the runner exposes `AIRunOptions.extraContext` to the agent
   * itself (CLI flag and/or prompt hint). When false/undefined, callers must
   * use the symlink fallback to make the skills source visible.
   */
  supportsExternalContext?: boolean;
  isAvailable(): boolean;
  run(prompt: string, notes?: string, options?: AIRunOptions): Promise<AIRunResult>;
}
