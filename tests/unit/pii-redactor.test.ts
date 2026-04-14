import { describe, it, expect } from "vitest";
import { PIIRedactor } from "../../src/security/pii-redactor.js";

describe("PII Redactor", () => {
  const redactor = new PIIRedactor();

  describe("email detection", () => {
    it("redacts email addresses", () => {
      const result = redactor.redact("Contact me at john.doe@example.com for details");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.category).toBe("email");
      expect(result.redactedText).toContain("[EMAIL_REDACTED]");
      expect(result.redactedText).not.toContain("john.doe@example.com");
    });

    it("redacts multiple emails", () => {
      const result = redactor.redact("Email a@b.com or c@d.org");
      expect(result.findings).toHaveLength(2);
    });
  });

  describe("phone detection", () => {
    it("redacts US phone numbers", () => {
      const result = redactor.redact("Call me at (555) 123-4567");
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
      expect(result.redactedText).toContain("[PHONE_REDACTED]");
    });

    it("redacts international phone numbers", () => {
      const result = redactor.redact("Phone: +44 20 7946 0958");
      expect(result.findings.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("SSN detection", () => {
    it("redacts valid SSNs", () => {
      const result = redactor.redact("SSN: 123-45-6789");
      expect(result.findings.some((f) => f.category === "ssn")).toBe(true);
      expect(result.redactedText).toContain("[SSN_REDACTED]");
    });

    it("rejects invalid SSN area codes", () => {
      const result = redactor.redact("Number: 000-45-6789");
      expect(result.findings.filter((f) => f.category === "ssn")).toHaveLength(0);
    });
  });

  describe("credit card detection", () => {
    it("redacts valid credit card numbers (Luhn)", () => {
      // 4111-1111-1111-1111 passes Luhn
      const result = redactor.redact("Card: 4111 1111 1111 1111");
      expect(result.findings.some((f) => f.category === "credit_card")).toBe(true);
      expect(result.redactedText).toContain("[CARD_REDACTED]");
    });

    it("rejects non-Luhn numbers", () => {
      const result = redactor.redact("Card: 1234 5678 9012 3456");
      expect(result.findings.filter((f) => f.category === "credit_card")).toHaveLength(0);
    });
  });

  describe("IP address detection", () => {
    it("redacts public IPs", () => {
      const result = redactor.redact("Server at 203.0.113.42");
      expect(result.findings.some((f) => f.category === "ip_address")).toBe(true);
    });

    it("skips localhost and private IPs", () => {
      const result = redactor.redact("localhost: 127.0.0.1");
      expect(result.findings.filter((f) => f.category === "ip_address")).toHaveLength(0);
    });
  });

  describe("auth URL detection", () => {
    it("redacts URLs with tokens", () => {
      const result = redactor.redact("Endpoint: https://api.example.com/v1?token=sk-12345");
      expect(result.findings.some((f) => f.category === "auth_url")).toBe(true);
      expect(result.redactedText).not.toContain("sk-12345");
    });
  });

  describe("configuration", () => {
    it("respects disabled flag", () => {
      const disabled = new PIIRedactor({ enabled: false });
      const result = disabled.redact("Email: test@example.com");
      expect(result.findings).toHaveLength(0);
      expect(result.redactedText).toBe("Email: test@example.com");
    });

    it("respects category filter", () => {
      const emailOnly = new PIIRedactor({
        categories: new Set(["email"]),
      });
      const result = emailOnly.redact("Email: a@b.com, Phone: (555) 123-4567");
      const emailFindings = result.findings.filter((f) => f.category === "email");
      const phoneFindings = result.findings.filter((f) => f.category === "phone");
      expect(emailFindings.length).toBeGreaterThanOrEqual(1);
      expect(phoneFindings).toHaveLength(0);
    });

    it("supports mask style", () => {
      const masked = new PIIRedactor({ redactionStyle: "mask" });
      const result = masked.redact("Email: test@example.com");
      expect(result.redactedText).toContain("***@***.***");
    });
  });

  describe("hasPII quick scan", () => {
    it("returns true when PII is present", () => {
      expect(redactor.hasPII("Email: test@example.com")).toBe(true);
    });

    it("returns false for clean text", () => {
      expect(redactor.hasPII("Hello world, no PII here.")).toBe(false);
    });
  });
});
