# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Mostly vibe coders: people building with AI who are NOT necessarily developers and may not know cron, .env files, hooks or MCP. Some are developers. Mix of quick check-ins (what did aidev do, kick off a run) and deeper sessions when something breaks (read logs, edit config/hooks/MCP, triage tasks).

## Product Purpose
Web dashboard for aidev, an AI-powered task executor. Manages `.env.aidev` config, schedule (cron), logs, tasks, run controls, hooks and MCP servers. Success: the user understands aidev's state at a glance and can change its behavior without hand-editing files.

## Capabilities and Constraints
- Routes: Dashboard, Config, Schedule, Logs, Tasks, Run, Hooks, MCP, Login. All features and API behavior are preserved in the redesign.
- Stack: Nuxt 4, Vue 3, Nuxt UI 4, Tailwind 4 (existing; keep).
- Known UX pain points (confirmed by user): navigation / findability across 8 flat sections; long, heavy Config and Hooks forms.

## Brand Commitments
The aidev logo is a bold blue "AI Dev" wordmark with a white outline (source: documentation/public/icons/aidev-nav.png, shown on https://qelos-io.github.io/aidev/). The UI's primary accent is the logo's blue; the logo appears in the sidebar and as the favicon.

## Product Principles
- Operate-first: scanability and speed over expression.
- Plain language first: explain settings in human terms, show technical names (env keys, cron, MCP) as secondary detail; sensible defaults, examples, and presets (e.g. schedule as 'every 30 min' not a cron string).
- Approachable, not intimidating: no terminal-cosplay; guide users through what each setting does and what can go wrong.
- Forms should be chunked, searchable and safe to edit (clear dirty/saved state).
- Status of aidev runs should be visible without hunting.

## Accessibility & Inclusion
No product-specific requirement established; follow WCAG AA.
