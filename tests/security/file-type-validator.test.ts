/**
 * Tests for the file-type validator (magika port).
 *
 * Verifies magic-byte detection covers the common formats and that
 * declared-vs-actual mismatch surfacing works for the upload-spoofing
 * scenario the validator exists to catch.
 */

import { describe, expect, it } from "vitest";

import {
  declaredVsActual,
  detectByMagicBytes,
  detectFileType,
} from "../../src/security/file-type-validator.js";

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ELF_HEAD = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
const ZIP_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const PDF_HEAD = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const TEXT_BUF = Buffer.from("hello world, this is plain text\n", "utf8");
const BINARY_GARBAGE = Buffer.from([0x42, 0xa3, 0xff, 0x00, 0x12, 0x73, 0x91, 0x00, 0xc8, 0xab]);

describe("detectByMagicBytes", () => {
  it("identifies PNG", () => {
    const v = detectByMagicBytes(PNG_HEAD);
    expect(v.detectedKind).toBe("png");
    expect(v.confidence).toBe("high");
  });
  it("identifies ELF", () => {
    expect(detectByMagicBytes(ELF_HEAD).detectedKind).toBe("elf");
  });
  it("identifies ZIP", () => {
    expect(detectByMagicBytes(ZIP_HEAD).detectedKind).toBe("zip");
  });
  it("identifies PDF", () => {
    expect(detectByMagicBytes(PDF_HEAD).detectedKind).toBe("pdf");
  });
  it("classifies plain text without magic signature", () => {
    const v = detectByMagicBytes(TEXT_BUF);
    expect(v.detectedKind).toBe("text");
    expect(v.confidence).toBe("medium");
  });
  it("classifies opaque binary as unknown", () => {
    const v = detectByMagicBytes(BINARY_GARBAGE);
    expect(v.detectedKind).toBe("unknown");
  });
});

describe("declaredVsActual", () => {
  it("detects mismatched declarations (the spoof scenario)", () => {
    const verdict = detectByMagicBytes(ELF_HEAD);
    const r = declaredVsActual("image/png", verdict);
    expect(r.match).toBe(false);
  });
  it("accepts type aliases (image -> jpeg)", () => {
    const verdict = detectByMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const r = declaredVsActual("image", verdict);
    expect(r.match).toBe(true);
  });
  it("accepts text-family aliases", () => {
    const verdict = detectByMagicBytes(TEXT_BUF);
    expect(declaredVsActual("text/plain", verdict).match).toBe(true);
  });
});

describe("detectFileType (with optional magika fallback)", () => {
  it("falls back to magic-byte when magika is not installed", async () => {
    const v = await detectFileType(PNG_HEAD);
    // we don't assert source — depending on the test environment magika
    // may or may not be installed. We DO assert that the answer is right.
    expect(v.detectedKind === "png" || v.detectedKind.includes("png") || v.detectedKind.includes("image")).toBe(true);
  });
});
