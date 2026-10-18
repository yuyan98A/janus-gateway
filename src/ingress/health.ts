import cluster from 'node:cluster';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { GatewayConfig } from '../types.ts';
import { drainTracker } from '../utils/drain.ts';

export async function handleHealth(
  req: IncomingMessage,
  res: ServerResponse,
  config: GatewayConfig
) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const mem = process.memoryUsage();
  const uptimeSeconds = process.uptime();

  res.end(
    JSON.stringify({
      status: 'ok',
      service: 'agent-model-gateway',
      version: '1.0.0',
      uptime: uptimeSeconds,
      startTime: new Date(Date.now() - Math.floor(uptimeSeconds * 1000)).toISOString(),
      timestamp: new Date().toISOString(),
      pid: process.pid,
      mode: cluster.isWorker ? 'cluster-worker' : 'standalone',
      inFlightRequests: drainTracker.getInFlightCount(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss
      },
      providers: {
        google: config.providers.google.enabled,
        codex: config.providers.codex.enabled
      }
    })
  );
}
