# Contributing to aidev

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Build and test: `npm install && npm run build`
5. Open a pull request

## Development Setup

```bash
git clone https://github.com/qelos-io/aidev
cd aidev
npm install
npm run dev -- init        # uses tsx, no build needed
npm run dev -- run --help
```

## Adding a New Provider

1. Create `src/providers/<name>.ts` implementing the `TaskProvider` interface:

```typescript
import { TaskProvider } from './base';
import { Task, Comment, Config } from '../types';

export class MyProvider implements TaskProvider {
  constructor(config: Config) { ... }
  async fetchTasks(): Promise<Task[]> { ... }
  async postComment(taskId: string, text: string): Promise<void> { ... }
  async getComments(taskId: string): Promise<Comment[]> { ... }
  async updateStatus(taskId: string, status: string): Promise<void> { ... }
}
```

2. Register it in `src/providers/index.ts`:

```typescript
case 'myprovider':
  return new MyProvider(config);
```

3. Add any new config keys to `src/types.ts` (`Config` interface) and `src/config.ts`.

4. Document the new env vars in `.env.aidev.example` and the docs site under `documentation/`.

## Adding a New AI Runner

1. Create `src/ai/<name>.ts` implementing the `AIRunner` interface:

```typescript
import { AIRunner, AIRunResult } from './base';

export class MyRunner implements AIRunner {
  readonly name = 'myrunner';
  isAvailable(): boolean { ... }
  async run(prompt: string, notes?: string): Promise<AIRunResult> { ... }
}
```

2. Register it in `src/ai/index.ts` and update the `AI_TOOL` logic.

## Code Style

- TypeScript strict mode
- No shell string concatenation for subprocess calls — always use array args with `spawnSync`
- Native `fetch` only — no HTTP library dependencies
- Keep dependencies minimal

## Pull Request Guidelines

- One feature/fix per PR
- Update the docs site (`documentation/`) if you add new config vars or commands
- Ensure `npm run build` passes before submitting
