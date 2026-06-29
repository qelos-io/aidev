# UI dashboard

`aidev ui` starts a local Nuxt dashboard for managing `.env.aidev`, browsing the log file, working with provider tasks, and triggering `aidev run` from a browser. The server binds to `127.0.0.1` only and requires a one-shot token printed when the command starts.

```bash
aidev ui                 # http://127.0.0.1:19422
aidev ui --port 19500
```

If you installed aidev from npm, the prebuilt Nuxt output is included and `aidev ui` serves it directly. From a source checkout, install dev deps once (`cd ui && npm install`) and `aidev ui` will run Nuxt in dev mode with hot reload; pass `--prod` to serve the built output instead.

The command prints a `http://127.0.0.1:<port>/login?token=<token>` URL — click it to authenticate. The token is regenerated on every launch and stored in the browser's `localStorage` for the session.

See `ui/docs/handover/` in the repository for per-screen design notes when extending the dashboard.
