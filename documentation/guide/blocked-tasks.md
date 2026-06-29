# Blocked tasks

If a task lists other tasks as blockers (via your provider's dependency feature), aidev will skip it until all blockers are closed.

## How it works

1. When a task is fetched, its blocking dependencies are read from the provider.
2. Before running the AI agent, aidev fetches each blocker task and checks its status.
3. If any blocker is still open, the task is skipped:

```
skipped: blocked by task <id> (status: in progress)
```

4. Once all blockers are resolved, the task is picked up on the next run.

## Per-provider support

| Provider | Blocking support | Source |
|---|---|---|
| ClickUp | Native | `dependencies` entries with `depends_on` |
| Jira | Native | Issue links where inward direction is `"is blocked by"` |
| Linear | Native | `inverseRelations` of type `blocks` |
| Monday.com | Native | Dependency column `linked_item_ids` |
| Notion | Optional | Relation property named **Blocked By** |
| Trello | Not supported | — |
| Local | Not applicable | — |

::: tip Notion setup
Add a **Relation** property named `Blocked By` to your task database. If absent, the check is silently skipped.
:::

## Edge cases

- If a blocker task cannot be fetched, it is treated as non-blocking.
- Only direct blockers are checked — transitive dependencies are not followed.
- If a provider does not implement `fetchTaskById`, the blocker check is silently skipped (fail open).
