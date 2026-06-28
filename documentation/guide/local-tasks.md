# Local tasks file (`aidev.tasks.json`)

`aidev.tasks.json` is an **outbound queue** — a JSON file at the root of your project that holds task templates aidev will publish to your configured provider. The [local provider](/guide/providers#local) **stores** tasks on disk; `aidev.tasks.json` **pushes** tasks to a remote provider.

Typical uses:

- **Recurring tasks** — with a `cron` expression, an entry publishes on every matching tick
- **Staged work** — queue a batch of tasks in a commit
- **AI-authored tasks** — another agent or script can append entries

The file is added to `.gitignore` by `aidev init`.

## File format

```ts
interface LocalTask {
  id: string;
  title: string;
  description: string;
  type: 'code' | 'non-code';
  priority?: number;       // 1=urgent … 4=low
  assignee?: string;
  dueDate?: string;        // ISO date
  tags?: string[];
  listId?: string;
  cron?: string;           // 5-field cron
  lastPushedAt?: number;   // epoch ms (managed by aidev)
}
```

**Example:**

```json
[
  {
    "id": "7f3a9c2d-5b1e-4a6f-9d8c-1e2f3a4b5c6d",
    "title": "Daily standup notes",
    "description": "Post yesterday / today / blockers to the team channel.",
    "type": "non-code",
    "priority": 3,
    "tags": ["standup"],
    "cron": "0 9 * * 1-5"
  },
  {
    "id": "2b8e1f7a-4c9d-4e5a-8b6c-9f1e2d3c4b5a",
    "title": "Upgrade dependencies",
    "description": "Run `npm outdated`, bump minor/patch versions, verify tests pass.",
    "type": "code",
    "priority": 2,
    "tags": ["maintenance"]
  }
]
```

## Lifecycle

1. Every `aidev run` begins by reading `aidev.tasks.json` and publishing each entry.
2. One-shot entries (no `cron`) are **removed** after a successful push.
3. Cron entries remain; `lastPushedAt` tracks the last successful push.
4. Failures are logged and the entry is kept for retry.

## Routing

- `type: 'code'` → published with the code tag to the primary provider.
- `type: 'non-code'` → published with `NON_CODE_TAG` to the non-code provider.
- Per-task `tags` are appended to the resolved default tag.
- Per-task `listId` overrides the provider-default list / project.

## Managing entries

```bash
aidev tasks add
aidev tasks ls
aidev tasks update [id]
aidev tasks remove [id]
aidev tasks push
```

`aidev tasks push` and `aidev run tasks` only process `aidev.tasks.json` and exit without invoking the AI.
