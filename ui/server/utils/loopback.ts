import type { H3Event } from 'h3';
import { getRequestIP } from 'h3';
import { isIP } from 'node:net';

/** True for 127.0.0.0/8 and IPv6 loopback (::1). */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  let addr = host.trim();
  if (addr.startsWith('::ffff:')) addr = addr.slice('::ffff:'.length);
  const kind = isIP(addr);
  if (kind === 4) return addr.split('.')[0] === '127';
  if (kind === 6) {
    const normalized = addr.toLowerCase();
    return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
  }
  return false;
}

/**
 * Whether the client is on loopback. Nuxt dev proxies often leave
 * socket.remoteAddress unset; getRequestIP and in-process sockets are fallbacks.
 */
export function isLoopbackClient(event: H3Event): boolean {
  const socket = event.node.req.socket;
  const candidates: Array<string | undefined> = [
    getRequestIP(event, { xForwardedFor: false }),
    socket.remoteAddress ?? undefined,
    event.node.req.connection?.remoteAddress ?? undefined,
  ];
  for (const c of candidates) {
    if (isLoopbackHost(c)) return true;
  }
  // In-process SSR / dev-proxy subrequests — no remote endpoint on the socket.
  if (!socket.remoteAddress && socket.remotePort == null) return true;
  return false;
}
