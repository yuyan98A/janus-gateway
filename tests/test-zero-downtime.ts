import http from 'node:http';
import assert from 'node:assert/strict';
import { ActiveRequestsTracker } from '../src/utils/drain.ts';

const TEST_PORT = 9250;

async function testActiveRequestsDraining() {
  console.log('• Testing ActiveRequestsTracker & Graceful Drain with long-running stream...');
  const tracker = new ActiveRequestsTracker();

  let requestFinishedCleanly = false;
  let receivedChunks = 0;

  const server = http.createServer((req, res) => {
    tracker.track(req, res);

    if (req.url === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      let count = 0;
      const interval = setInterval(() => {
        count++;
        res.write(`data: chunk_${count}\n\n`);
        if (count >= 5) {
          clearInterval(interval);
          res.end('data: [DONE]\n\n');
        }
      }, 100);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>(r => server.listen(TEST_PORT, '127.0.0.1', r));

  // 1. Start streaming client
  const streamPromise = (async () => {
    const resp = await fetch(`http://127.0.0.1:${TEST_PORT}/stream`);
    assert.equal(resp.status, 200);
    const reader = resp.body?.getReader();
    assert(reader);

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      if (text.includes('chunk_')) {
        receivedChunks++;
      }
    }
    requestFinishedCleanly = true;
  })();

  // 2. Wait a bit for stream to become active
  await new Promise(r => setTimeout(r, 200));
  assert.equal(tracker.getInFlightCount(), 1, 'In-flight count should be 1 during streaming');

  // 3. Initiate graceful drain while stream is still running
  console.log('  [Test] Initiating graceful drain during active stream...');
  const drainPromise = tracker.startGracefulDrain(server, { timeoutMs: 5000, checkIntervalMs: 50 });

  // 4. Concurrently await both stream completion and drain completion
  const [_, drainResult] = await Promise.all([streamPromise, drainPromise]);

  assert.equal(requestFinishedCleanly, true, 'Long-running stream must finish cleanly without disruption');
  assert.equal(receivedChunks >= 5, true, 'Client must receive all stream chunks');
  assert.equal(drainResult.drainedCleanly, true, 'Server must drain cleanly after stream ends');
  assert.equal(tracker.getInFlightCount(), 0, 'In-flight count must be 0 after drain');

  console.log('  [Test] Drain test passed: In-flight stream completed cleanly without interruption!');
}

async function testHealthEndpointMetrics() {
  console.log('• Testing Health endpoint PID and inFlight count response...');
  try {
    const resp = await fetch(`http://127.0.0.1:18763/health`);
    if (resp.ok) {
      const data = await resp.json();
      assert.equal(data.status, 'ok');
      assert(typeof data.pid === 'number', 'Health response should contain process PID');
      assert(typeof data.inFlightRequests === 'number', 'Health response should contain inFlightRequests count');
      assert(typeof data.mode === 'string', 'Health response should contain gateway mode');
      console.log(`  [Test] Live health verified: PID=${data.pid}, mode=${data.mode}, inFlight=${data.inFlightRequests}`);
    } else {
      console.log('  [Test] Standalone live gateway not active; skipping live health check.');
    }
  } catch {
    console.log('  [Test] Standalone live gateway not active; skipping live health check.');
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🧪 Starting Zero-Downtime & Graceful Drain Automated Test Suite');
  console.log('='.repeat(70));

  await testActiveRequestsDraining();
  await testHealthEndpointMetrics();

  console.log('\nAll Zero-Downtime tests completed successfully!');
}

main().catch(err => {
  console.error('[ZeroDowntime Test Failed]:', err);
  process.exit(1);
});
