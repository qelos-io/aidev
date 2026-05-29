import { defineEventHandler, createError, getRequestHeader, getQuery } from 'h3';
import { isLoopbackClient } from '../utils/loopback';

// Loopback-only listener is enforced by NITRO_HOST=127.0.0.1 in src/commands/ui.ts,
// but we double-check the client on protected API routes so a misconfigured deploy
// can't silently expose the dashboard.
export default defineEventHandler((event) => {
  const url = event.node.req.url ?? '';
  // Only enforce on our own API surface. Nuxt reserves `/api/_*` for internal
  // endpoints (icon proxy, devtools probes, etc.). Page routes are public HTML;
  // data access still requires bearer auth below.
  if (!url.startsWith('/api/') || url.startsWith('/api/_')) return;

  if (!isLoopbackClient(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  const expected = process.env.AIDEV_UI_TOKEN ?? '';
  if (!expected) {
    // The CLI always sets AIDEV_UI_TOKEN before spawning Nuxt — missing token
    // means the server was started outside the aidev entrypoint.
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_UI_TOKEN not configured' });
  }

  const auth = getRequestHeader(event, 'authorization') ?? '';
  let token = '';
  if (auth.startsWith('Bearer ')) {
    token = auth.slice('Bearer '.length).trim();
  } else {
    const q = getQuery(event);
    const raw = q.token;
    token = typeof raw === 'string' ? raw : '';
  }

  if (token !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }
});
