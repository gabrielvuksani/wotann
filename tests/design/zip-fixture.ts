/**
 * Test helper — builds a minimal valid ZIP archive in memory.
 *
 * We don't use any ZIP library so tests don't depend on anything beyond
 * Node's built-in `zlib`. Only stored (method 0) and deflated (method 8)
 * entries are emitted, which matches the subset our reader supports.
 */
import { deflateRawSync } from "node:zlib";

// Standalone CRC32 (ISO 3309 / PKZIP) so we don't depend on Node 22+'s
// `zlib.crc32`. Test fixtures need to work under the package's declared
// engines (node >= 20).
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    const idx = (c ^ byte) & 0xff;
    c = (CRC_TABLE[idx] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface FixtureEntry {
  readonly name: string;
  readonly data: Buffer;
  readonly deflate: boolean;
}

export interface FixtureFile {
  readonly name: string;
  readonly contents: string | Buffer;
  readonly deflate?: boolean;
}

export function buildZipBuffer(files: readonly FixtureFile[]): Buffer {
  const entries: Array<{
    readonly entry: FixtureEntry;
    readonly raw: Buffer;
    readonly compressed: Buffer;
    readonly crc: number;
    readonly localOffset: number;
  }> = [];

  const chunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = Buffer.isBuffer(file.contents) ? file.contents : Buffer.from(file.contents, "utf-8");
    const shouldDeflate = file.deflate !== false && raw.length > 0;
    const compressed = shouldDeflate ? deflateRawSync(raw) : raw;
    const method = shouldDeflate ? 8 : 0;
    const crc = crc32(raw);

    const nameBuf = Buffer.from(file.name, "utf-8");
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(method, 8); // method
    lfh.writeUInt16LE(0, 10); // mod time
    lfh.writeUInt16LE(0, 12); // mod date
    lfh.writeUInt32LE(crc >>> 0, 14);
    lfh.writeUInt32LE(compressed.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra length

    chunks.push(lfh, nameBuf, compressed);
    const localOffset = offset;
    offset += lfh.length + nameBuf.length + compressed.length;

    entries.push({
      entry: { name: file.name, data: raw, deflate: shouldDeflate },
      raw,
      compressed,
      crc,
      localOffset,
    });
  }

  const cdirStart = offset;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.entry.name, "utf-8");
    const cdir = Buffer.alloc(46);
    cdir.writeUInt32LE(0x02014b50, 0); // central dir signature
    cdir.writeUInt16LE(20, 4); // version made by
    cdir.writeUInt16LE(20, 6); // version needed
    cdir.writeUInt16LE(0, 8); // flags
    cdir.writeUInt16LE(e.entry.deflate ? 8 : 0, 10);
    cdir.writeUInt16LE(0, 12); // mod time
    cdir.writeUInt16LE(0, 14); // mod date
    cdir.writeUInt32LE(e.crc >>> 0, 16);
    cdir.writeUInt32LE(e.compressed.length, 20);
    cdir.writeUInt32LE(e.raw.length, 24);
    cdir.writeUInt16LE(nameBuf.length, 28);
    cdir.writeUInt16LE(0, 30); // extra
    cdir.writeUInt16LE(0, 32); // comment
    cdir.writeUInt16LE(0, 34); // disk
    cdir.writeUInt16LE(0, 36); // internal
    cdir.writeUInt32LE(0, 38); // external
    cdir.writeUInt32LE(e.localOffset, 42);
    chunks.push(cdir, nameBuf);
    offset += cdir.length + nameBuf.length;
  }
  const cdirSize = offset - cdirStart;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // cdir start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdirSize, 12);
  eocd.writeUInt32LE(cdirStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  chunks.push(eocd);

  return Buffer.concat(chunks);
}
