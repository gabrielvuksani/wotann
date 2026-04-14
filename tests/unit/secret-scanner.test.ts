import { describe, it, expect } from "vitest";
import { SecretScanner, PIIRedactor } from "../../src/security/secret-scanner.js";

describe("SecretScanner", () => {
  it("detects Anthropic API keys", () => {
    const scanner = new SecretScanner();
    const result = scanner.scanText("My key is sk-ant-abcdefghijklmnopqrstuvwxyz123456");
    expect(result.clean).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]!.pattern).toBe("anthropic_key");
    expect(result.findings[0]!.severity).toBe("critical");
  });

  it("detects OpenAI API keys", () => {
    const scanner = new SecretScanner();
    const result = scanner.scanText("Token: sk-abcdefghijklmnopqrstuvwxyz12345678");
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.pattern === "openai_key")).toBe(true);
  });

  it("detects GitHub tokens", () => {
    const scanner = new SecretScanner();
    const result = scanner.scanText("ghp_abcdef1234567890abcdef1234567890abcdef");
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.pattern === "github_token")).toBe(true);
  });

  it("detects AWS access keys", () => {
    const scanner = new SecretScanner();
    const result = scanner.scanText("Access key: AKIAIOSFODNN7EXAMPLE");
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.pattern === "aws_access_key")).toBe(true);
  });

  it("detects private key headers", () => {
    const scanner = new SecretScanner();
    const result = scanner.scanText("-----BEGIN RSA PRIVATE KEY-----");
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.pattern === "private_key")).toBe(true);
  });

  it("detects connection strings", () => {
    const scanner = new SecretScanner();
    const result = scanner.scanText("postgres://admin:s3cretP4ss@db.example.com:5432/mydb");
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.pattern === "connection_string")).toBe(true);
  });

  it("returns clean for innocent text", () => {
    const scanner = new SecretScanner();
    const result = scanner.scanText("Hello world, this is a normal message about coding.");
    expect(result.clean).toBe(true);
    expect(result.findings.length).toBe(0);
  });

  it("scans URLs for encoded secrets", () => {
    const scanner = new SecretScanner();
    const encoded = encodeURIComponent("sk-ant-abcdefghijklmnopqrstuvwxyz123456");
    const result = scanner.scanUrl(`https://evil.com/exfil?data=${encoded}`);
    expect(result.clean).toBe(false);
  });

  it("detects protected credential directories", () => {
    const scanner = new SecretScanner();
    const home = process.env["HOME"] ?? "/home/user";
    expect(scanner.isProtectedPath(`${home}/.ssh/id_rsa`)).toBe(true);
    expect(scanner.isProtectedPath(`${home}/.aws/credentials`)).toBe(true);
    expect(scanner.isProtectedPath(`${home}/.docker/config.json`)).toBe(true);
    expect(scanner.isProtectedPath(`${home}/projects/myapp/src/index.ts`)).toBe(false);
  });

  it("allows explicitly allowed paths", () => {
    const scanner = new SecretScanner();
    const home = process.env["HOME"] ?? "/home/user";
    const protectedPath = `${home}/.ssh/config`;
    expect(scanner.isProtectedPath(protectedPath)).toBe(true);
    scanner.allowPath(protectedPath);
    expect(scanner.isProtectedPath(protectedPath)).toBe(false);
  });

  it("supports custom patterns", () => {
    const scanner = new SecretScanner();
    scanner.addPattern({
      name: "custom_token",
      pattern: /WOTANN_TOKEN_[A-Z0-9]{20}/g,
      severity: "high",
      description: "Custom WOTANN token",
    });
    const result = scanner.scanText("Token: WOTANN_TOKEN_ABCDEF1234567890ABCD");
    expect(result.clean).toBe(false);
    expect(result.findings[0]!.pattern).toBe("custom_token");
  });

  it("redacts sensitive content", () => {
    const scanner = new SecretScanner();
    const text = "Key: sk-ant-abcdefghijklmnopqrstuvwxyz123456";
    const redacted = scanner.redactContent(text);
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redacted).toContain("sk-a"); // Keeps first 4 chars
  });

  it("tracks scan statistics", () => {
    const scanner = new SecretScanner();
    scanner.scanText("clean text");
    scanner.scanText("sk-ant-abcdefghijklmnopqrstuvwxyz123456");
    const stats = scanner.getStats();
    expect(stats.scans).toBe(2);
    expect(stats.findings).toBeGreaterThan(0);
  });
});

describe("PIIRedactor (authoritative — from pii-redactor.ts)", () => {
  it("redacts email addresses when enabled", () => {
    const redactor = new PIIRedactor({ enabled: true });
    const result = redactor.redact("Contact: user@example.com for more info");
    expect(result.redactedText).not.toContain("user@example.com");
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("redacts phone numbers", () => {
    const redactor = new PIIRedactor({ enabled: true });
    const result = redactor.redact("Call (555) 123-4567 for support");
    expect(result.redactedText).not.toContain("(555) 123-4567");
  });

  it("redacts credit card numbers", () => {
    const redactor = new PIIRedactor({ enabled: true });
    const result = redactor.redact("Card: 4111 1111 1111 1111");
    expect(result.redactedText).not.toContain("4111 1111 1111 1111");
  });

  it("does not redact when disabled", () => {
    const redactor = new PIIRedactor({ enabled: false });
    const original = "Email: user@example.com";
    const result = redactor.redact(original);
    expect(result.redactedText).toBe(original);
    expect(result.totalRedacted).toBe(0);
  });

  it("returns findings with categories", () => {
    const redactor = new PIIRedactor({ enabled: true });
    const result = redactor.redact("user@example.com and 555-123-4567");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.category === "email")).toBe(true);
  });

  it("is enabled by default (authoritative version)", () => {
    const redactor = new PIIRedactor();
    // The authoritative PIIRedactor from pii-redactor.ts is enabled by default
    const result = redactor.redact("Customer: user@example.com");
    expect(result.redactedText).not.toContain("user@example.com");
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
