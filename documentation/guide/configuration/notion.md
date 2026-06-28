# Notion configuration

| Variable | Default | Description |
|---|---|---|
| `NOTION_API_KEY` | — | Integration token from Notion → Settings → My integrations |
| `NOTION_DATABASE_ID` | — | Database ID from the database URL (32-char hex) |
| `NOTION_STATUS_PROPERTY` | `Status` | Name of the status property in the database |
| `NOTION_PENDING_STATUS` | `pending` | Status value for "waiting for reply" |
| `NOTION_IN_REVIEW_STATUS` | `review` | Status value set after implementation |

::: warning Manual setup
Notion is fully functional but not yet included in the `aidev init` wizard. Set `PROVIDER=notion` in `.env.aidev` and fill in the variables above.
:::

[← Back to configuration overview](/guide/configuration)
