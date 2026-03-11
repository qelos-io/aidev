---
name: aidev-add-ai-runner
description: Add a new AI runner (e.g. another CLI agent) to the aidev project. Use when implementing a new AIRunner, adding a new agent to AGENTS, or extending which AI tools aidev can invoke.
---

# Adding an AI Runner to aidev

Use this skill when adding a new AI runner (e.g. another CLI-based agent) so the agent follows the project’s runner contract and wiring.

## Checklist

1. **Implement AIRunner** — Create `src/ai/<name>.ts` implementing the interface from `src/ai/base.ts`:
   - `name: string` — short id (lowercase, e.g. `'myrunner'`)
   - `isAvailable(): boolean` — true if the runner’s CLI is on PATH (use `commandExists()` from `src/platform.ts` if appropriate)
   - `run(prompt: string, notes?: string): Promise<AIRunResult>` — use `spawnSync(bin, [...args])` with array arguments only; return `{ success, output, error }`
   Use `getUserShellEnv()` from `src/platform.ts` for env when spawning if the CLI needs the user’s shell environment.

2. **Register runner** — In `src/ai/index.ts`: import the new runner class and add it to the `registry` object. `createRunners(config)` already returns runners in `config.agents` order; no change needed there if the new name is in `config.agents`.

3. **AgentName type** — In `src/types.ts`: add the new runner id to the `AgentName` union (e.g. `'claude' | 'cursor' | 'windsurf' | 'myrunner'`).

4. **Config validation** — In `src/config.ts` in `loadConfig()`: add the new id to the `validAgents` array so `AGENTS` can include it.

5. **Init picker** — In `src/commands/init.ts`: add the new id to the `VALID_AGENTS` array so `aidev init` lists and accepts it.

6. **Permissions (optional)** — If the runner needs permission or availability checks during `aidev init`, in `src/permissions.ts` add a branch in `validateAgentPermissions()` for the new agent name (e.g. `else if (agent === 'myrunner') { await validateMyRunnerPermissions(rl, dir); }`).

7. **Docs and tests** — Update `.env.aidev.example` comment for `AGENTS` if you add a new option. Add or extend tests in `src/__tests__/ai-runners.test.ts`. Run `npm run build` and `npm test`.

## Reference

- Existing runners: `src/ai/claude.ts`, `src/ai/cursor.ts`, `src/ai/windsurf.ts`.
- Interface: `src/ai/base.ts` (`AIRunner`, `AIRunResult`).
- Registry and createRunners: `src/ai/index.ts`.
- Valid agents and init: `src/config.ts` (`validAgents`), `src/commands/init.ts` (`VALID_AGENTS`), `src/permissions.ts` (`validateAgentPermissions`).
