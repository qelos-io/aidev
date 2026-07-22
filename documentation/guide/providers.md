# Providers

<ProviderGrid />

## Status overview

| Provider | Status | `aidev init` support |
|---|---|---|
| ClickUp | ✅ Implemented | ✅ Interactive wizard |
| Jira | ✅ Implemented | ✅ Interactive wizard |
| Linear | ✅ Implemented | ✅ Interactive wizard |
| Monday.com | ✅ Implemented | ✅ Interactive wizard |
| Local | ✅ Implemented | ✅ Interactive wizard |
| Notion | ✅ Implemented | Manual `.env.aidev` config |
| Trello | ✅ Implemented | ✅ Interactive wizard |

The `TaskProvider` interface makes it straightforward to add new providers. See [Contributing](/contributing).

## ClickUp {#clickup}

See [ClickUp configuration](/guide/configuration/clickup).

## Jira {#jira}

See [Jira configuration](/guide/configuration/jira).

## Linear {#linear}

See [Linear configuration](/guide/configuration/linear).

## Monday.com {#monday}

See [Monday.com configuration](/guide/configuration/monday).

## Notion {#notion}

::: warning Manual setup
Set `PROVIDER=notion` in `.env.aidev` and fill in the required variables from [Notion configuration](/guide/configuration/notion).
:::

## Trello {#trello}

See [Trello configuration](/guide/configuration/trello).

## Local provider {#local}

Set `PROVIDER=local` in `.env.aidev` to manage tasks entirely via local markdown files — no external API needed.

```bash
aidev init   # choose "local" when prompted for provider
```

Tasks live in `.aidev/tasks/` under status folders:

```
.aidev/tasks/
  open/          # new tasks ready for implementation
  pending/       # waiting for human reply
  progress/      # currently being implemented
  review/        # implementation complete, awaiting review
  done/          # finished
```

### Task file format

Example: `.aidev/tasks/open/a1b2c3d4-fix-login-bug.md`

```markdown
---
title: Fix login page bug
priority: 2
assignee: david
estimated: 2h
tags: frontend, auth
created: 2026-03-12T10:00:00.000Z
---

The login form should redirect users to the dashboard after successful authentication.
```

The filename must start with a short ID (hex characters) followed by a dash and a slug. YAML frontmatter carries metadata; everything after `---` is the task description.

### Code vs non-code tasks

By default, local tasks are **code tasks** — aidev creates a git branch, runs the AI agent, commits, pushes, and opens a PR.

For **non-code** tasks, add `type: non-code` to the frontmatter:

```markdown
---
title: Compare OAuth2 providers
type: non-code
tags: research
---

Evaluate Auth0, Clerk, and Supabase Auth. Write a recommendation.
```

### Consult tasks

For **consult** tasks (perspective replies on pending tickets), add the consultant tag to frontmatter and place the file under `pending/`:

```markdown
---
title: Consumer repro steps?
tags: qelos, isaac-consult
---

Latest question from the SDK agent…
```

See [Consult tasks](/guide/consult-tasks) for the full cross-project flow.

### Session file (comments)

`.aidev/tasks/open/a1b2c3d4-fix-login-bug.session.md`:

```markdown
<!-- aidev session log — append your comments below using "## your-name" as header -->

---

## aidev — 2026-03-12T10:05:00.000Z

[aidev] Starting implementation on branch `a1b2c3d4/fix-login-bug`

---

## david — 2026-03-12T10:10:00.000Z

Please use the new auth API endpoint for this.
```

Downloaded task attachments are stored in `.aidev/assets/<task-id>/`. With **safe mode** enabled (default), secret values from `.env` / `.env.aidev` are redacted before they reach AI agents.
