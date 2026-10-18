import assert from 'node:assert/strict';
import { EventSourceParser, parseEventSourceStream } from '../src/utils/event-source-parser.ts';

async function run() {
  console.log('• Testing EventSourceParser basic event parsing...');
  const events: any[] = [];
  const parser = new EventSourceParser({ onEvent: e => events.push(e) });
  parser.feed('event: message\ndata: hello\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'message');
  assert.equal(events[0].data, 'hello');

  console.log('• Testing multiple data lines and comments...');
  events.length = 0;
  parser.feed(': this is a comment\r\nevent: custom\r\ndata: line1\r\ndata: line2\r\n\r\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'custom');
  assert.equal(events[0].data, 'line1\nline2');

  console.log('• Testing chunk splitting across \\r\\n boundaries...');
  events.length = 0;
  parser.feed('data: part1');
  assert.equal(events.length, 0);
  parser.feed('\r\n\r');
  assert.equal(events.length, 0);
  parser.feed('\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].data, 'part1');

  console.log('• Testing UTF-8 split chunk stream decoding...');
  const encoder = new TextEncoder();
  const chunk1 = encoder.encode('data: {"text": "');
  const fullEmoji = '🌟你好世界';
  const encodedFull = encoder.encode(fullEmoji);
  // Split in middle of multi-byte sequence
  const chunk2 = encodedFull.slice(0, 5);
  const chunk3 = encodedFull.slice(5);
  const chunk4 = encoder.encode('"}\n\n');

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk1);
      controller.enqueue(chunk2);
      controller.enqueue(chunk3);
      controller.enqueue(chunk4);
      controller.close();
    }
  });

  const parsed: any[] = [];
  for await (const ev of parseEventSourceStream(stream)) {
    parsed.push(ev);
  }
  assert.equal(parsed.length, 1);
  assert.equal(JSON.parse(parsed[0].data).text, '🌟你好世界');

  console.log('EventSourceParser unit tests passed successfully!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
