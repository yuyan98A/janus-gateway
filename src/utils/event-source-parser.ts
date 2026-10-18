/**
 * EventSource (SSE) Parser
 * A robust, zero-dependency, W3C-compliant SSE stream state-machine parser.
 * Handles split chunks, UTF-8 boundaries, arbitrary line endings (\r\n, \n, \r),
 * multiline data fields, comments, and event framing.
 */

export interface ServerSentEvent {
  type: 'event';
  id?: string;
  event?: string;
  data: string;
}

export interface EventSourceParserOptions {
  onEvent: (event: ServerSentEvent) => void;
  onError?: (error: Error) => void;
}

export class EventSourceParser {
  private buffer = '';
  private currentEvent = '';
  private currentData = '';
  private currentId = '';
  private onEvent: (event: ServerSentEvent) => void;

  constructor(options: EventSourceParserOptions) {
    this.onEvent = options.onEvent;
  }

  /**
   * Feed incoming string chunk into the state machine.
   */
  public feed(chunk: string): void {
    this.buffer += chunk;

    let lineStart = 0;
    const len = this.buffer.length;

    for (let i = 0; i < len; i++) {
      const code = this.buffer.charCodeAt(i);

      if (code === 10 /* \n */ || code === 13 /* \r */) {
        // If \r is the very last character of the buffer, wait for next chunk
        // in case it's followed by \n (\r\n).
        if (code === 13 && i === len - 1) {
          break;
        }

        const line = this.buffer.slice(lineStart, i);

        // Check for \r\n pair
        if (code === 13 && i + 1 < len && this.buffer.charCodeAt(i + 1) === 10) {
          i++; // Skip \n
        }

        lineStart = i + 1;
        this.parseLine(line);
      }
    }

    this.buffer = this.buffer.slice(lineStart);
  }

  /**
   * Parse a single line extracted from the stream.
   */
  private parseLine(line: string): void {
    // Empty line indicates event boundary
    if (line === '') {
      this.dispatchCurrentEvent();
      return;
    }

    // Comment line starts with ':'
    if (line.charCodeAt(0) === 58 /* ':' */) {
      return;
    }

    const colonIdx = line.indexOf(':');
    let field = '';
    let value = '';

    if (colonIdx === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colonIdx);
      value = line.slice(colonIdx + 1);
      // Strip single leading space if present
      if (value.charCodeAt(0) === 32 /* ' ' */) {
        value = value.slice(1);
      }
    }

    if (field === 'data') {
      this.currentData = this.currentData ? `${this.currentData}\n${value}` : value;
    } else if (field === 'event') {
      this.currentEvent = value;
    } else if (field === 'id') {
      if (!value.includes('\0')) {
        this.currentId = value;
      }
    }
  }

  /**
   * Dispatch the accumulated event and reset state.
   */
  private dispatchCurrentEvent(): void {
    if (this.currentData !== '' || this.currentEvent !== '' || this.currentId !== '') {
      this.onEvent({
        type: 'event',
        ...(this.currentId ? { id: this.currentId } : {}),
        ...(this.currentEvent ? { event: this.currentEvent } : {}),
        data: this.currentData
      });

      this.currentEvent = '';
      this.currentData = '';
      this.currentId = '';
    }
  }

  /**
   * Flush any remaining data at stream completion.
   */
  public flush(): void {
    if (this.buffer.length > 0) {
      this.parseLine(this.buffer);
      this.buffer = '';
    }
    this.dispatchCurrentEvent();
  }

  /**
   * Reset parser state.
   */
  public reset(): void {
    this.buffer = '';
    this.currentEvent = '';
    this.currentData = '';
    this.currentId = '';
  }
}

/**
 * Async generator that consumes a ReadableStream<Uint8Array> and yields ServerSentEvent items.
 * Uses TextDecoder({ fatal: false, stream: true }) for safe multi-byte UTF-8 handling.
 */
export async function* parseEventSourceStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<ServerSentEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const queue: ServerSentEvent[] = [];

  const parser = new EventSourceParser({
    onEvent: (ev) => {
      queue.push(ev);
    }
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value && value.length > 0) {
        parser.feed(decoder.decode(value, { stream: true }));
        while (queue.length > 0) {
          yield queue.shift()!;
        }
      }
    }

    // Flush any pending multi-byte UTF-8 and trailing buffer
    const finalChunk = decoder.decode();
    if (finalChunk) {
      parser.feed(finalChunk);
    }
    parser.flush();

    while (queue.length > 0) {
      yield queue.shift()!;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore lock release error if reader already closed
    }
  }
}
