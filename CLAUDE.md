# aidev — Claude Project Rules

## Build & Run
```bash
npm run build          # tsc + chmod +x dist/cli.js
npm run dev -- <cmd>   # run via tsx without building
node dist/cli.js --help
```

## Project Layout
- `src/cli.ts` — Commander entry point; `run` is the default command (`isDefault: true`)
- `src/providers/` — `TaskProvider` interface + ClickUp implementation (native `fetch`)
- `src/ai/` — `AIRunner` interface + Claude/Cursor runners (`spawnSync`)
- `src/commands/` — `init`, `run`, `schedule`
- `src/git.ts` — all git ops via `spawnSync('git', [...args])`, never string concat

## Strict Rules
- **No shell injection**: always pass args as arrays to `spawnSync`, never interpolate into shell strings
- **No new HTTP dependencies**: use native `fetch` (Node 18+) only
- **CJS only**: `"type": "commonjs"` — do not use ESM syntax or ESM-only packages
- **chalk v4**: project uses chalk v4 (not v5, which is ESM-only)
- **`node:` prefix**: all built-in imports use `node:fs`, `node:path`, `node:child_process`, etc.

## Adding a Provider
1. Create `src/providers/<name>.ts` implementing `TaskProvider`
2. Register in `src/providers/index.ts` `createProvider()` switch
3. Add config fields to `src/types.ts` (`Config`) and `src/config.ts`
4. Document in `.env.aidev.example` and `README.md`

## Adding an AI Runner
1. Create `src/ai/<name>.ts` implementing `AIRunner`
2. Register in `src/ai/index.ts` `createRunners()` and update `AI_TOOL` logic
