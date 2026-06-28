# Trello configuration

| Variable | Default | Description |
|---|---|---|
| `TRELLO_API_KEY` | — | Developer API key from [trello.com/power-ups/admin](https://trello.com/power-ups/admin) |
| `TRELLO_TOKEN` | — | Auth token generated via Trello's token flow |
| `TRELLO_BOARD_ID` | — | Board ID from the board URL |
| `TRELLO_LABEL` | — | Label name on cards to pick up (set to `*` to match all cards assigned to the token user) |
| `TRELLO_OPEN_LIST` | `To Do` | List name for open/new cards |
| `TRELLO_PENDING_LIST` | `Blocked` | List name for "waiting for reply" |
| `TRELLO_IN_PROGRESS_LIST` | `Doing` | List name for cards being worked on |
| `TRELLO_IN_REVIEW_LIST` | `In Review` | List name for completed cards awaiting review |
| `TRELLO_OPEN_STATUS` | `open` | Semantic status mapped to the open list |
| `TRELLO_PENDING_STATUS` | `pending` | Semantic status mapped to the pending list |
| `TRELLO_IN_REVIEW_STATUS` | `review` | Semantic status mapped to the review list |

[← Back to configuration overview](/guide/configuration)
