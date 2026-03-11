---
name: aidev-add-provider
description: Add a new task provider (e.g. Notion, Trello) to the aidev project. Use when implementing a new TaskProvider, wiring a new PROVIDER option, or extending aidev to support another task source.
---

# Adding a Task Provider to aidev

Use this skill when adding a new task source (e.g. Notion, Trello) so the agent follows the project’s provider pattern and wiring.

## Checklist

1. **Implement TaskProvider** — Create `src/providers/<name>.ts` implementing the interface from `src/providers/base.ts`:
   - `fetchTasks(): Promise<Task[]>`
   - `postComment(taskId, text): Promise<void>`
   - `getComments(taskId): Promise<Comment[]>`
   - `updateStatus(taskId, status): Promise<void>`
   - `createTask(params): Promise<CreateTaskResult>`
   Use native `fetch` only; no shell interpolation; use `spawnSync(bin, [...args])` if calling a CLI.

2. **Register in factory** — In `src/providers/index.ts`: import the new provider class and add a `case '<name>': return new XxxProvider(config);` in `createProvider()`. For not-yet-implemented providers keep: `throw new Error('X provider is not yet implemented. Contributions welcome!');`

3. **Config types** — In `src/types.ts`: add any provider-specific fields to the `Config` interface (e.g. `xxxApiKey`, `xxxProject`).

4. **Config loading** — In `src/config.ts` inside `loadConfig()`:
   - When `provider === '<name>'`, add the required env var keys to the `required` array and ensure they are validated.
   - Map `process.env` to the new `Config` fields (with defaults if appropriate).

5. **Documentation** — Add a section to `.env.aidev.example` for the new provider’s env vars. Update README.md if it lists providers or setup steps.

6. **Tests** — Add or extend tests in `src/__tests__/providers.test.ts` (or a dedicated test file) so the new provider is covered. Run `npm test` and fix failures.

## Reference

- Existing implementations: `src/providers/clickup.ts`, `src/providers/jira.ts`.
- Interface: `src/providers/base.ts`.
- Types: `src/types.ts` (`Task`, `Comment`, `CreateTaskParams`, `CreateTaskResult`, `Config`).
