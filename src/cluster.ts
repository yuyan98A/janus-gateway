import cluster from 'node:cluster';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerScript = path.resolve(__dirname, 'index.ts');

// CLI command mode: "npm run reload" or "node src/cluster.ts reload"
const args = process.argv.slice(2);
if (args[0] === 'reload' || args[0] === 'upgrade') {
  await handleCliReload();
  process.exit(0);
}

async function handleCliReload() {
  const config = loadConfig();
  const port = config.server.port;
  const rawHost = config.server.host || '127.0.0.1';
  const host = (rawHost === '0.0.0.0' || rawHost === '::') ? '127.0.0.1' : rawHost;
  const apiKey = config.server.apiKey;
  const url = `http://${host}:${port}/v1/admin/gateway/upgrade`;

  console.log(`[Reload CLI] Sending rolling upgrade signal to gateway at ${url}...`);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`[Reload CLI] Success:`, data.message || data);
      console.log(`[Reload CLI] Active in-flight requests during handover: ${data.inFlightRequests ?? 0}`);
    } else {
      const err = await response.text();
      console.error(`[Reload CLI] Upgrade request rejected (HTTP ${response.status}):`, err);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`[Reload CLI] Failed to connect to gateway: ${error.message}`);
    console.error(`[Reload CLI] Make sure the cluster gateway is running on port ${port}.`);
    process.exit(1);
  }
}

// Master Process Orchestrator
if (cluster.isPrimary) {
  const config = loadConfig();
  const PORT = config.server.port;
  const HOST = config.server.host || '127.0.0.1';

  const dataDir = path.resolve(__dirname, '..', 'data');
  const pidFilePath = path.join(dataDir, 'gateway.pid');

  // Instance mutual exclusion check
  if (fs.existsSync(pidFilePath)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(pidFilePath, 'utf8'));
      const existingPid = existingData?.pid;
      if (typeof existingPid === 'number' && isProcessAlive(existingPid)) {
        console.warn(`[Master] Gateway is already running with PID ${existingPid} on port ${existingData.port || PORT}.`);
        console.warn(`[Master] To hot-reload code, run 'npm run reload'. To stop, run 'npm run service:stop'.`);
        process.exit(0);
      } else {
        console.log(`[Master] Cleaning up stale PID file for inactive process (PID: ${existingPid})...`);
        fs.unlinkSync(pidFilePath);
      }
    } catch {
      try { fs.unlinkSync(pidFilePath); } catch {}
    }
  }

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Record Master PID
  const pidRecord = {
    pid: process.pid,
    port: PORT,
    host: HOST,
    startTime: new Date().toISOString()
  };
  fs.writeFileSync(pidFilePath, JSON.stringify(pidRecord, null, 2), 'utf8');

  const removePidFile = () => {
    try {
      if (fs.existsSync(pidFilePath)) {
        const raw = fs.readFileSync(pidFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.pid === process.pid) {
          fs.unlinkSync(pidFilePath);
        }
      }
    } catch {}
  };

  process.on('exit', removePidFile);

  // Unhandled error guards to keep Master supervisor robust
  process.on('uncaughtException', (err) => {
    console.error('[Master] Uncaught exception in master orchestrator:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[Master] Unhandled rejection in master orchestrator:', reason);
  });

  cluster.setupPrimary({
    exec: workerScript
  });

  let activeWorker: ReturnType<typeof cluster.fork> | null = null;
  const drainingWorkers = new Set<ReturnType<typeof cluster.fork>>();
  let isUpgrading = false;

  console.log('='.repeat(70));
  console.log(`🚀 Virtual Model Gateway Zero-Downtime Cluster Master [PID ${process.pid}]`);
  console.log(`   - Target Port        : http://${HOST}:${PORT}`);
  console.log(`   - Worker Entrypoint  : ${workerScript}`);
  console.log(`   - Graceful Upgrade   : POST /v1/admin/gateway/upgrade or 'npm run reload'`);
  console.log('='.repeat(70));

  function forkNewWorker(): Promise<ReturnType<typeof cluster.fork>> {
    return new Promise((resolve, reject) => {
      const worker = cluster.fork();
      const pid = worker.process.pid;
      console.log(`[Master] Forked new worker [PID ${pid}]...`);

      const readyTimeout = setTimeout(() => {
        cleanup();
        worker.kill();
        reject(new Error(`Worker [PID ${pid}] failed to send ready signal within 45s.`));
      }, 45000);

      const onMessage = (msg: any) => {
        if (msg?.type === 'ready') {
          cleanup();
          clearTimeout(readyTimeout);
          console.log(`[Master] Worker [PID ${pid}] is READY and listening on port ${msg.port || PORT}.`);
          resolve(worker);
        } else if (msg?.type === 'request_upgrade') {
          console.log(`[Master] Upgrade requested via IPC from Worker [PID ${pid}].`);
          void performRollingUpgrade();
        }
      };

      const onExit = (code: number | null, signal: string | null) => {
        cleanup();
        clearTimeout(readyTimeout);
        reject(new Error(`Worker [PID ${pid}] exited before ready (code: ${code}, signal: ${signal}).`));
      };

      const cleanup = () => {
        worker.off('message', onMessage);
        worker.off('exit', onExit);
      };

      worker.on('message', onMessage);
      worker.on('exit', onExit);
    });
  }

  async function performRollingUpgrade() {
    if (isUpgrading) {
      console.warn('[Master] Upgrade already in progress. Ignoring duplicate request.');
      return;
    }

    isUpgrading = true;
    console.log('\n[Master] ===> INITIATING ZERO-DOWNTIME ROLLING UPGRADE <===');
    const oldWorker = activeWorker;

    try {
      // 1. Launch new worker with fresh code
      const newWorker = await forkNewWorker();
      activeWorker = newWorker;
      bindActiveWorkerEvents(newWorker);

      // 2. Safely retire old worker
      if (oldWorker && oldWorker.isConnected()) {
        const oldPid = oldWorker.process.pid;
        console.log(`[Master] Disconnecting old worker [PID ${oldPid}] from new incoming connections...`);
        drainingWorkers.add(oldWorker);

        // Disconnect stops master from passing new TCP connections to this worker
        oldWorker.disconnect();

        // Send drain signal to allow in-flight streaming requests to finish cleanly
        oldWorker.send({ type: 'drain' });

        oldWorker.once('exit', (code, signal) => {
          drainingWorkers.delete(oldWorker);
          console.log(`[Master] Old worker [PID ${oldPid}] cleanly exited (code: ${code}, signal: ${signal}).`);
        });
      }

      console.log(`[Master] ===> ROLLING UPGRADE COMPLETED SUCCESSFULLY (Active PID: ${newWorker.process.pid}) <===\n`);
    } catch (err: any) {
      console.error('[Master] Rolling upgrade failed:', err.message);
      if (oldWorker && !drainingWorkers.has(oldWorker)) {
        console.log(`[Master] Preserving existing active worker [PID ${oldWorker.process.pid}].`);
        activeWorker = oldWorker;
      }
    } finally {
      isUpgrading = false;
    }
  }

  function bindActiveWorkerEvents(worker: ReturnType<typeof cluster.fork>) {
    worker.on('message', (msg: any) => {
      if (msg?.type === 'request_upgrade') {
        console.log(`[Master] Received upgrade request from active worker [PID ${worker.process.pid}].`);
        void performRollingUpgrade();
      }
    });

    worker.on('exit', (code, signal) => {
      if (drainingWorkers.has(worker)) {
        drainingWorkers.delete(worker);
        return;
      }

      if (activeWorker === worker) {
        console.warn(`[Master] Active worker [PID ${worker.process.pid}] died unexpectedly (code: ${code}, signal: ${signal}).`);
        activeWorker = null;
        if (!isUpgrading) {
          console.log('[Master] Auto-healing: spawning replacement worker immediately...');
          void forkNewWorker().then(w => {
            activeWorker = w;
            bindActiveWorkerEvents(w);
          }).catch(e => console.error('[Master] Failed to auto-respawn worker:', e.message));
        }
      }
    });
  }

  // Initial startup
  try {
    const initialWorker = await forkNewWorker();
    activeWorker = initialWorker;
    bindActiveWorkerEvents(initialWorker);
  } catch (err: any) {
    console.error('[Master] Fatal: Failed to start initial worker:', err.message);
    process.exit(1);
  }

  // Graceful shutdown of entire cluster
  let masterShuttingDown = false;
  async function shutdownCluster() {
    if (masterShuttingDown) process.exit(0);
    masterShuttingDown = true;
    console.log('\n[Master] Shutting down cluster...');

    const allWorkers = [
      ...(activeWorker ? [activeWorker] : []),
      ...Array.from(drainingWorkers)
    ];

    for (const w of allWorkers) {
      if (w.isConnected()) {
        try {
          w.send({ type: 'drain' });
          w.disconnect();
        } catch {
          // ignore
        }
      }
    }

    setTimeout(() => {
      console.log('[Master] Cluster shutdown complete.');
      removePidFile();
      process.exit(0);
    }, 3000);
  }

  process.on('SIGINT', shutdownCluster);
  process.on('SIGTERM', shutdownCluster);
}
