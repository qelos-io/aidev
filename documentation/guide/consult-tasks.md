# Consult tasks

Consult tasks let one aidev project answer a **perspective question** on a ticket owned by another project — without git branching, without moving the ticket to review, and with an explicit handback to the primary agent.

Typical use case: a SDK bug reported through a consumer app. The SDK project (qelos) asks a question; you tag the ticket for the consumer project (isaac) to reply from its repo; isaac posts its perspective and returns the ticket to **pending** so qelos can continue.

## Human-in-the-loop

Consult routing is always manual. Project A does not know project B exists on the board — you add the consultant's tag when you want their input.

<ConsultFlowDiagram />

## Tag convention

Each project has a tag family:

| Tag | Default | Purpose |
|---|---|---|
| `{folder}` | `qelos` | Code tasks — full SDLC |
| `{folder}-other` | `qelos-other` | Non-code tasks — no git |
| `{folder}-consult` | `qelos-consult` | **This agent** should consult (human adds to ticket) |
| `{folder}-consulted` | `qelos-consulted` | Stats marker after consult completes |

When qelos needs isaac's perspective on a qelos ticket, add **`isaac-consult`** (not `qelos-consult`).

```bash
# Defaults — override per project directory
CONSULT_TAG=isaac-consult
CONSULTED_TAG=isaac-consulted
```

Re-consult: add `isaac-consult` again anytime. The `-consulted` tag is kept for stats/history.

## Comment prefixes

Each project should use a distinct comment prefix so peer replies unblock pending on the primary agent:

```bash
# Default expands to [aidev-qelos], [aidev-isaac], etc.
AIDEV_COMMENT_PREFIX=[aidev-$PROJECT_NAME]

# Or a custom template:
AIDEV_COMMENT_PREFIX='My Bot ($PROJECT_NAME): '
```

`$PROJECT_NAME` and `$FOLDER_NAME` expand to the project directory name during `loadConfig`.

Pin the legacy shared prefix on existing setups:

```bash
AIDEV_COMMENT_PREFIX=[aidev]
```

## Flow

See the diagram above for the full story. In short:

1. Ticket created on the shared board, tagged **`qelos`**
2. Qelos picks up the task and starts implementation
3. Qelos posts a follow-up question → ticket moves to **pending**
4. You add label **`isaac-consult`**
5. Isaac cron runs (`aidev run pending` or `aidev run`) → consult phase picks up the ticket
6. Isaac posts `[aidev-isaac] …` perspective from its repo
7. Isaac removes `isaac-consult`, adds `isaac-consulted`, ticket stays **pending**
8. Qelos sees a non-own-prefix reply → resumes implementation

Consult tasks only run when status is **pending** and stay **pending** after completion.

## Multi-project setup

Shared API keys via `AIDEV_ENV_EXTEND`; per-project tags and prefixes in each `.env.aidev`:

```bash
# qelos/.env.aidev
TRELLO_LABEL=qelos
NON_CODE_TAG=qelos-other
# CONSULT_TAG defaults to qelos-consult (for when others consult qelos)

# isaac/.env.aidev
TRELLO_LABEL=isaac
NON_CODE_TAG=isaac-other
# CONSULT_TAG defaults to isaac-consult — watches isaac-consult on any card
```

## Provider notes

Consult uses the same tag/label filter as code and non-code tasks. Provider-specific details:

| Provider | Tag filter field | Notes |
|---|---|---|
| ClickUp | `CLICKUP_TAG` (overridden to `CONSULT_TAG`) | Same as code tasks |
| Jira | `JIRA_LABEL` | Same as code tasks |
| Linear | `LINEAR_LABEL` | Same as code tasks |
| Trello | `TRELLO_LABEL` | Same as code tasks |
| Notion | `CLICKUP_TAG` | Requires a **Tags** multi-select property on the database |
| Monday.com | `CLICKUP_TAG` + `MONDAY_TAG_COLUMN_ID` | Text column with comma-separated tags |
| Local | `tags:` in frontmatter | Consult mode scans **pending/** only |

### Notion

Set `CLICKUP_TAG` to your project/consult tag name (same convention as other providers). Pages must have a `Tags` (or `tags`) multi-select property.

### Monday.com

Add a text column for tags and set:

```bash
CLICKUP_TAG=isaac-consult
MONDAY_TAG_COLUMN_ID=tags
```

Store comma-separated tags in that column (e.g. `qelos, isaac-consult`).

### Local provider

Pending task with consult tag in frontmatter:

```markdown
---
title: Consumer repro steps?
tags: qelos, isaac-consult
---

Latest question from qelos agent…
```

File must live under `.aidev/tasks/pending/`.

## Related

- [Non-code tasks](/guide/non-code-tasks)
- [Behaviour configuration](/guide/configuration/behaviour)
- [Scheduling](/guide/scheduling)
