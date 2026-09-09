import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Config } from './types';

/** Deterministic, per-PID socket path so both sides compute the same path from a known PID. */
export function configSocketPath(pid: number): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\aidev-config-${pid}`
    : path.join(os.tmpdir(), `aidev-config-${pid}.sock`);
}

/** Payload served by the parent. `env` is the set of env vars the parent loaded from its env files. */
export interface ConfigInheritPayload {
  config: Config;
  env: Record<string, string>;
  pid: number;
}

export interface ConfigServer {
  close(): void;
  readonly path: string;
}

/**
 * Starts a local server on `configSocketPath(pid)` that responds to a single
 * request with `payload` as a JSON line, then half-closes. On POSIX, unlinks any
 * stale socket file before listen and sets the listening socket mode to 0o600.
 * Returns a handle with `close()` that stops the server and removes the socket file.
 * Throws if the server cannot start — caller decides how to handle.
 */
export function startConfigServer(payload: ConfigInheritPayload, pid: number): ConfigServer {
  const socketPath = configSocketPath(pid);
  const isPosix = process.platform !== 'win32';

  if (isPosix) {
    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch {
      // ignore — best-effort cleanup of stale socket
    }
  }

  const body = JSON.stringify(payload) + '\n';
  const server = net.createServer((socket) => {
    let received = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      // Read until a newline; ignore the request body content.
      if (!received && chunk.indexOf('\n') !== -1) {
        received = true;
        socket.end(body);
      }
    });
    socket.on('error', () => {
      // Ignore per-connection errors so the server stays up.
    });
  });

  server.listen(socketPath);

  if (isPosix) {
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {
      // ignore — best-effort permission hardening
    }
  }

  let closed = false;

  const cleanupSocket = (): void => {
    if (isPosix) {
      try {
        if (fs.existsSync(socketPath)) {
          fs.unlinkSync(socketPath);
        }
      } catch {
        // ignore
      }
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    try {
      server.close();
    } catch {
      // ignore
    }
    cleanupSocket();
  };

  // Remove the socket file if the process exits unexpectedly.
  const exitHandler = (): void => {
    cleanupSocket();
  };
  process.once('exit', exitHandler);

  return { close, path: socketPath };
}

/**
 * Connects to the config server for `parentPid`, sends the request, reads the
 * JSON response, and returns the parsed payload. Resolves null on any error
 * (connection refused, timeout, malformed JSON). Never throws.
 */
export function requestConfig(parentPid: number, timeoutMs: number = 3000): Promise<ConfigInheritPayload | null> {
  return new Promise((resolve) => {
    const socketPath = configSocketPath(parentPid);
    let settled = false;
    let buffer = '';

    const finish = (value: ConfigInheritPayload | null): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const socket = net.createConnection({ path: socketPath }, () => {
      socket.write('GET_CONFIG\n');
    });

    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        const line = buffer.slice(0, nl);
        try {
          const parsed = JSON.parse(line) as ConfigInheritPayload;
          finish(parsed);
        } catch {
          finish(null);
        }
      }
    });

    socket.on('error', () => {
      finish(null);
    });

    socket.on('timeout', () => {
      finish(null);
    });

    socket.on('close', () => {
      // If we close without having parsed a payload, resolve null.
      finish(null);
    });
  });
}
