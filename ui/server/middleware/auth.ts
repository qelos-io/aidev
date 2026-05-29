import { defineEventHandler, createError, getRequestHeader, getQuery } from 'h3';

// Loopback-only listener is enforced by NITRO_HOST=127.0.0.1 in src/commands/ui.ts,
// but we double-check the socket here so a misconfigured deploy can't silently
// expose the dashboard.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export default defineEventHandler((event) => {
  const remote = event.node.req.socket.remoteAddress ?? '';
  if (!LOOPBACK.has(remote)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  const url = event.node.req.url ?? '';
  // Only enforce bearer on our own API surface. Nuxt reserves `/api/_*` for
  // internal endpoints (icon proxy, devtools probes, etc.) — gating those
  // would break the SPA before the user even reaches the login screen.
  if (!url.startsWith('/api/') || url.startsWith('/api/_')) return;

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
