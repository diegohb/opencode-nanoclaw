/**
 * Inbound HTTP server for sidecar-based channels.
 *
 * Sidecar containers (e.g. Teams) forward inbound messages here via
 * POST /channel/inbound. This server replaces the old credential-proxy
 * approach — credentials are now managed by OneCLI, so the proxy is gone
 * and this is the sole inbound endpoint.
 */
import http from 'http';

import { logger } from './logger.js';
import { NewMessage } from './types.js';
import { SIDECAR_INBOUND_PORT } from './config.js';

type SidecarInboundCallback = (payload: {
  channel: string;
  jid: string;
  message: NewMessage;
  metadata?: { name?: string; isGroup?: boolean; channel?: string };
}) => void;

let sidecarCallback: SidecarInboundCallback | null = null;

/** Register a callback for sidecar inbound messages. Called by index.ts at startup. */
export function registerSidecarCallback(cb: SidecarInboundCallback): void {
  sidecarCallback = cb;
}

/** Start the inbound HTTP server on the configured port. */
export function startInboundServer(
  port: number = SIDECAR_INBOUND_PORT,
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/channel/inbound' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString());
          if (!sidecarCallback) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No sidecar callback registered' }));
            return;
          }
          sidecarCallback(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          logger.error({ err }, 'Failed to process sidecar inbound');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'Sidecar inbound server listening');
  });

  return server;
}
