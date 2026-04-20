/**
 * AWS Event-Stream binary framing codec for Bedrock Converse streams.
 *
 * Bedrock's `/converse-stream` endpoint emits messages in the AWS
 * event-stream format (vnd.amazon.eventstream), a length-prefixed
 * binary framing with CRCs. The pre-fix Bedrock adapter scanned the
 * raw bytes with regex against JSON-shaped substrings — that works
 * MOST of the time but breaks in three concrete ways:
 *
 *   a) When a frame's payload straddles a TCP chunk boundary, the
 *      regex matches the partial half and swallows the tail in the
 *      next iteration (or double-emits).
 *   b) When a JSON payload contains `}"` inside a string value (e.g.
 *      `"text": "value with } character"`), the lazy regex
 *      `[^}]*?` terminates early and the payload is truncated.
 *   c) Binary headers interleaved between payload bytes show up as
 *      UTF-8 replacement characters in the decoded text, and when
 *      the replacement happens to land inside a matched group the
 *      parsed text is corrupt.
 *
 * Rather than take a 8+ MB runtime dependency on
 * `@aws-sdk/eventstream-codec`, we hand-roll the decoder from the
 * public spec. The format is intentionally simple:
 *
 *   Prelude (12 bytes)
 *     - total_length     : uint32 BE — includes prelude + headers + payload + trailer CRC
 *     - headers_length   : uint32 BE — bytes of headers (no prelude)
 *     - prelude_crc      : uint32 BE — CRC32 of the first 8 prelude bytes
 *   Headers (headers_length bytes)
 *     Each header entry:
 *       - name_length    : uint8
 *       - name           : ASCII name_length bytes
 *       - value_type     : uint8  (0=bool_true, 1=bool_false, 2=int8, 3=int16,
 *                                  4=int32, 5=int64, 6=byte_array, 7=string,
 *                                  8=timestamp, 9=uuid)
 *       - value_length   : uint16 BE (only for types 6, 7)
 *       - value          : bytes
 *   Payload (total_length - headers_length - 16 bytes)
 *   Message CRC (4 bytes) — CRC32 of everything EXCEPT the final CRC
 *
 * For Bedrock Converse, only string-typed headers (type 7) matter:
 *   :message-type = "event" | "exception" | "error"
 *   :event-type   = "contentBlockStart" | "contentBlockDelta" |
 *                   "contentBlockStop"  | "messageStart"       |
 *                   "messageStop"       | "messageDelta"       | "metadata"
 *   :content-type = "application/json"
 *
 * The decoder validates frame length consistency but deliberately
 * skips CRC verification — that tradeoff matches how the rest of
 * the repo handles third-party stream framing, and a broken CRC
 * would manifest later as malformed-JSON errors which the adapter
 * already handles gracefully. If a CRC bug ever surfaces in the wild
 * we can wire in zlib's `crc32` without changing this API.
 */

/** Kinds of value our Bedrock decoder cares about. Only strings appear in
 * practice, but we retain the type enum to keep the decoder honest. */
const VALUE_TYPE_BOOL_TRUE = 0;
const VALUE_TYPE_BOOL_FALSE = 1;
const VALUE_TYPE_BYTE = 2;
const VALUE_TYPE_SHORT = 3;
const VALUE_TYPE_INTEGER = 4;
const VALUE_TYPE_LONG = 5;
const VALUE_TYPE_BYTE_ARRAY = 6;
const VALUE_TYPE_STRING = 7;
const VALUE_TYPE_TIMESTAMP = 8;
const VALUE_TYPE_UUID = 9;

const PRELUDE_LENGTH = 12;
const TRAILER_LENGTH = 4; // message-CRC trailer

/**
 * Headers present on an event-stream message, keyed by the header name
 * (which includes the leading colon for reserved names, e.g.
 * `:message-type`). Values are always coerced to strings in the
 * Bedrock context — see the VALUE_TYPE_* constants for the full
 * set the decoder understands.
 */
export interface EventStreamHeaders {
  readonly [name: string]: string;
}

export interface EventStreamMessage {
  readonly headers: EventStreamHeaders;
  readonly payload: Buffer;
}

/**
 * Pure-function decode: extract as many complete messages as possible
 * from the front of `buffer`, returning the decoded messages alongside
 * a tail `remaining` buffer with the still-incomplete bytes. Callers
 * append the next TCP chunk onto `remaining` and call again. This
 * mirrors how the bedrock adapter's reader loop naturally works.
 *
 * Returns `{ messages: [], remaining: buffer }` when the buffer holds
 * less than one full frame — never throws on insufficient bytes.
 * Throws only on structurally-invalid frames (e.g. headers_length
 * greater than total_length), which indicates a protocol violation
 * the caller should surface as a stream error.
 */
export function decodeEventStreamFrames(buffer: Buffer): {
  readonly messages: readonly EventStreamMessage[];
  readonly remaining: Buffer;
} {
  const messages: EventStreamMessage[] = [];
  let offset = 0;

  while (offset + PRELUDE_LENGTH <= buffer.length) {
    const totalLength = buffer.readUInt32BE(offset);
    const headersLength = buffer.readUInt32BE(offset + 4);

    if (totalLength < PRELUDE_LENGTH + TRAILER_LENGTH + headersLength) {
      throw new Error(
        `event-stream frame invalid: total_length=${totalLength} < prelude+trailer+headers_length=${
          PRELUDE_LENGTH + TRAILER_LENGTH + headersLength
        }`,
      );
    }
    // Not enough bytes yet — wait for the next chunk.
    if (offset + totalLength > buffer.length) break;

    const headersStart = offset + PRELUDE_LENGTH;
    const headersEnd = headersStart + headersLength;
    const payloadEnd = offset + totalLength - TRAILER_LENGTH;

    const headers = decodeHeaders(buffer, headersStart, headersEnd);
    const payload = buffer.subarray(headersEnd, payloadEnd);
    messages.push({ headers, payload: Buffer.from(payload) });
    offset += totalLength;
  }

  return {
    messages,
    // Copy the tail — the caller may be reusing the input buffer and we
    // don't want to return a subarray whose bytes shift under them.
    remaining: Buffer.from(buffer.subarray(offset)),
  };
}

function decodeHeaders(buffer: Buffer, start: number, end: number): EventStreamHeaders {
  const out: Record<string, string> = {};
  let cursor = start;
  while (cursor < end) {
    const nameLen = buffer.readUInt8(cursor);
    cursor += 1;
    if (cursor + nameLen > end) {
      throw new Error("event-stream headers truncated while reading name");
    }
    const name = buffer.subarray(cursor, cursor + nameLen).toString("ascii");
    cursor += nameLen;
    if (cursor + 1 > end) {
      throw new Error("event-stream headers truncated before value-type");
    }
    const valueType = buffer.readUInt8(cursor);
    cursor += 1;

    switch (valueType) {
      case VALUE_TYPE_BOOL_TRUE:
        out[name] = "true";
        break;
      case VALUE_TYPE_BOOL_FALSE:
        out[name] = "false";
        break;
      case VALUE_TYPE_BYTE: {
        const v = buffer.readInt8(cursor);
        cursor += 1;
        out[name] = String(v);
        break;
      }
      case VALUE_TYPE_SHORT: {
        const v = buffer.readInt16BE(cursor);
        cursor += 2;
        out[name] = String(v);
        break;
      }
      case VALUE_TYPE_INTEGER: {
        const v = buffer.readInt32BE(cursor);
        cursor += 4;
        out[name] = String(v);
        break;
      }
      case VALUE_TYPE_LONG: {
        const v = buffer.readBigInt64BE(cursor);
        cursor += 8;
        out[name] = String(v);
        break;
      }
      case VALUE_TYPE_BYTE_ARRAY:
      case VALUE_TYPE_STRING: {
        const len = buffer.readUInt16BE(cursor);
        cursor += 2;
        if (cursor + len > end) {
          throw new Error("event-stream headers truncated while reading string value");
        }
        const s = buffer.subarray(cursor, cursor + len).toString("utf-8");
        cursor += len;
        out[name] = s;
        break;
      }
      case VALUE_TYPE_TIMESTAMP: {
        const v = buffer.readBigInt64BE(cursor);
        cursor += 8;
        out[name] = String(v);
        break;
      }
      case VALUE_TYPE_UUID: {
        const v = buffer.subarray(cursor, cursor + 16).toString("hex");
        cursor += 16;
        out[name] = v;
        break;
      }
      default:
        throw new Error(`event-stream header value-type not supported: ${valueType}`);
    }
  }
  return out;
}

/**
 * Encode a single event-stream frame for tests. This is the inverse of
 * `decodeEventStreamFrames` for a one-message buffer. Only string-typed
 * headers are produced — that's the only variant Bedrock emits. The
 * encoder writes zero CRCs since the decoder deliberately skips CRC
 * verification; if future work enables CRC checks, the encoder should
 * be updated in lock-step.
 */
export function encodeEventStreamMessage(
  headers: Record<string, string>,
  payload: Buffer,
): Uint8Array {
  // Serialize headers first to know headers_length.
  const headerChunks: Buffer[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBuf = Buffer.from(name, "ascii");
    const valueBuf = Buffer.from(value, "utf-8");
    if (nameBuf.length > 0xff) throw new Error("header name too long");
    if (valueBuf.length > 0xffff) throw new Error("header value too long");
    const entry = Buffer.alloc(1 + nameBuf.length + 1 + 2 + valueBuf.length);
    let o = 0;
    entry.writeUInt8(nameBuf.length, o);
    o += 1;
    nameBuf.copy(entry, o);
    o += nameBuf.length;
    entry.writeUInt8(VALUE_TYPE_STRING, o);
    o += 1;
    entry.writeUInt16BE(valueBuf.length, o);
    o += 2;
    valueBuf.copy(entry, o);
    headerChunks.push(entry);
  }
  const headersBuf = Buffer.concat(headerChunks);
  const totalLength = PRELUDE_LENGTH + headersBuf.length + payload.length + TRAILER_LENGTH;

  const frame = Buffer.alloc(totalLength);
  frame.writeUInt32BE(totalLength, 0);
  frame.writeUInt32BE(headersBuf.length, 4);
  // prelude CRC — zero; our decoder skips CRC verification.
  frame.writeUInt32BE(0, 8);
  headersBuf.copy(frame, PRELUDE_LENGTH);
  payload.copy(frame, PRELUDE_LENGTH + headersBuf.length);
  // trailing message CRC — zero, as above.
  frame.writeUInt32BE(0, totalLength - TRAILER_LENGTH);
  return new Uint8Array(frame);
}

/**
 * Convenience: pull the `:event-type` header off a decoded message, if
 * present. Callers that only care about event dispatch (Bedrock's
 * adapter) don't need to re-parse the header object.
 */
export function getEventType(msg: EventStreamMessage): string | undefined {
  return msg.headers[":event-type"];
}

/**
 * Convenience: pull the `:message-type` header. Bedrock emits
 * "event" | "exception" | "error"; the adapter branches on this to
 * know whether `payload` is a success event or an error.
 */
export function getMessageType(msg: EventStreamMessage): string | undefined {
  return msg.headers[":message-type"];
}
