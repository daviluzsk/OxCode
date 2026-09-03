import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SwarmBus } from './bus.js';
import { VIEWER_HTML } from './viewer.js';

export interface SwarmServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/**
 * Tiny zero-dependency HTTP server for the swarm visualization.
 *
 * - `GET /`        the self-contained 3D office viewer
 * - `GET /state`   JSON snapshot (replay buffer + blackboard)
 * - `GET /events`  Server-Sent Events stream (snapshot first, then live)
 *
 * SSE is used instead of WebSockets so there is no runtime dependency.
 */
export async function startSwarmServer(
  bus: SwarmBus,
  preferredPort = 4517,
  fsociety?: () => boolean,
): Promise<SwarmServer> {
  const clients = new Set<http.ServerResponse>();

  const unsubscribe = bus.subscribe((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        /* dropped client; cleaned up on 'close' */
      }
    }
  });

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/' || url.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      const html = VIEWER_HTML.replace('__OX_FSOCIETY_FLAG__', fsociety?.() ? 'true' : 'false');
      res.end(html);
      return;
    }
    if (url === '/state') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(bus.snapshot()));
      return;
    }
    if (url === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      // Replay everything so far, then stream live.
      res.write(`event: snapshot\ndata: ${JSON.stringify(bus.snapshot())}\n\n`);
      clients.add(res);
      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* ignore */
        }
      }, 15000);
      req.on('close', () => {
        clearInterval(keepAlive);
        clients.delete(res);
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const port = await listen(server, preferredPort);
  const url = `http://localhost:${port}`;

  return {
    url,
    port,
    async close() {
      unsubscribe();
      for (const res of clients) res.end();
      clients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Listen on `preferred`, falling back to an OS-assigned free port if taken. */
function listen(server: http.Server, preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        server.listen(0, '127.0.0.1');
      } else {
        reject(err);
      }
    };
    server.on('error', onError);
    server.on('listening', () => {
      server.off('error', onError);
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
    server.listen(preferred, '127.0.0.1');
  });
}
