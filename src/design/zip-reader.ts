/**
 * Minimal ZIP archive reader — zero-dep, pure Node.
 *
 * Implements just enough of the ZIP spec (PKZIP APPNOTE v6.3.2) to satisfy
 * Claude Design's handoff-bundle format:
 *   - Stored entries (method 0)
 *   - DEFLATE-compressed entries (method 8) via `node:zlib`
 *   - End-of-central-directory lookup (no ZIP64, no encryption)
 *
 * We avoid `adm-zip` because it ships as a transitive dep of `magika`
 * rather than a direct dependency and has no first-party TypeScript types.
 * A 150-line native reader gives us strict types, honest errors, and no new
 * supply-chain surface.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  readonly name: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly method: number;
  readonly isDirectory: boolean;
  readonly data: () => Buffer;
}

// PKZIP signatures.
const EOCD_SIGNATURE = 0x06054b50;
const CDIR_SIGNATURE = 0x02014b50;
const LFH_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT = 0xffff;

function findEndOfCentralDir(buf: Buffer): number {
  const maxStart = Math.max(0, buf.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT);
  // Scan backwards from the end — the EOCD is near the tail in well-formed files.
  for (let i = buf.length - EOCD_MIN_SIZE; i >= maxStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  return -1;
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  entry(name: string): ZipEntry | undefined;
}

export function readZip(zipPath: string): ZipArchive {
  let buf: Buffer;
  try {
    buf = readFileSync(zipPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot read ZIP file ${zipPath}: ${msg}`);
  }
  if (buf.length < EOCD_MIN_SIZE) {
    throw new Error(
      `${zipPath} is not a valid ZIP archive — too small (${buf.length} bytes, need ≥${EOCD_MIN_SIZE})`,
    );
  }

  const eocd = findEndOfCentralDir(buf);
  if (eocd < 0) {
    throw new Error(`not a valid ZIP archive: ${zipPath} (no end-of-central-directory signature)`);
  }

  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdirSize = buf.readUInt32LE(eocd + 12);
  const cdirOffset = buf.readUInt32LE(eocd + 16);

  if (cdirOffset + cdirSize > buf.length) {
    throw new Error(`ZIP central directory exceeds archive bounds in ${zipPath}`);
  }

  const entries: ZipEntry[] = [];
  let cursor = cdirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== CDIR_SIGNATURE) {
      throw new Error(`malformed ZIP central directory at offset ${cursor}`);
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localHeaderOffset = buf.readUInt32LE(cursor + 42);

    const name = buf.slice(cursor + 46, cursor + 46 + nameLen).toString("utf-8");
    const isDirectory = name.endsWith("/");

    const entryCompressedSize = compressedSize;
    const entryUncompressedSize = uncompressedSize;
    const entryMethod = method;
    const entryLocalOffset = localHeaderOffset;

    entries.push({
      name,
      size: uncompressedSize,
      compressedSize,
      method,
      isDirectory,
      data: () => {
        if (isDirectory) return Buffer.alloc(0);
        if (
          entryLocalOffset + 30 > buf.length ||
          buf.readUInt32LE(entryLocalOffset) !== LFH_SIGNATURE
        ) {
          throw new Error(`malformed local file header for ${name}`);
        }
        const lfhNameLen = buf.readUInt16LE(entryLocalOffset + 26);
        const lfhExtraLen = buf.readUInt16LE(entryLocalOffset + 28);
        const dataStart = entryLocalOffset + 30 + lfhNameLen + lfhExtraLen;
        const dataEnd = dataStart + entryCompressedSize;
        if (dataEnd > buf.length) {
          throw new Error(`ZIP data for ${name} exceeds archive bounds`);
        }
        const raw = buf.slice(dataStart, dataEnd);
        if (entryMethod === 0) {
          return Buffer.from(raw);
        }
        if (entryMethod === 8) {
          try {
            const inflated = inflateRawSync(raw);
            if (inflated.length !== entryUncompressedSize) {
              throw new Error(
                `ZIP entry ${name}: inflated size ${inflated.length} != header ${entryUncompressedSize}`,
              );
            }
            return inflated;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`failed to inflate ZIP entry ${name}: ${msg}`);
          }
        }
        throw new Error(
          `unsupported ZIP compression method ${entryMethod} for ${name} (only STORED=0 and DEFLATE=8)`,
        );
      },
    });

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  const byName = new Map<string, ZipEntry>();
  for (const entry of entries) {
    byName.set(entry.name, entry);
  }

  return {
    entries,
    entry: (name: string) => byName.get(name),
  };
}
