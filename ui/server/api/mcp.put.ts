import { defineEventHandler, readBody, createError } from 'h3';
import { writeMcpFile, assertMcpServersShape } from '../utils/mcpFile';

interface PutBody {
  servers?: unknown;
}

export default defineEventHandler(async (event) => {
  const cwd = process.env.AIDEV_CWD;
  if (!cwd) {
    throw createError({ statusCode: 500, statusMessage: 'AIDEV_CWD not set' });
  }

  const body = await readBody<PutBody>(event);
  if (!body || !('servers' in body)) {
    throw createError({ statusCode: 400, statusMessage: 'Body must be { servers: Record<string, McpServerDef> }' });
  }

  assertMcpServersShape(body.servers);
  return writeMcpFile(cwd, body.servers);
});
