/**
 * ObserverPolicyEditor — V9 T12.12 Mastra Studio sub-component.
 *
 * JSON editor for an observer policy with a Validate button. The
 * underlying observer engine is OUT OF SCOPE for this slice — this
 * component renders, parses, and validates JSON, then surfaces the
 * decoded value through `onSave` so a future RPC layer can persist
 * it.
 *
 * Per the brief: "JSON editor with validate button." We add a few
 * niceties (line numbers, pretty-print, parse-error hint) without
 * inventing a full schema validator — the daemon owns schema rules.
 *
 * DESIGN NOTES
 * - Per-component state: draft text, parse error, dirty flag.
 * - Honest stubs: parse failures render in a banner — never silent.
 * - Forward-compat: callers can supply a custom `validate` predicate
 *   for richer schema checks (the default just runs JSON.parse).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";

// ── Types ───────────────────────────────────────────────────

export interface ObserverPolicy {
  readonly version: number;
  readonly rules: readonly ObserverRule[];
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export interface ObserverRule {
  readonly id: string;
  readonly description?: string;
  readonly when: Readonly<Record<string, unknown>>;
  readonly action: "allow" | "deny" | "warn" | "log";
  readonly priority?: number;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly message?: string;
}

export interface ObserverPolicyEditorProps {
  readonly initialPolicy?: ObserverPolicy | null;
  readonly onSave?: (policy: ObserverPolicy) => void;
  readonly onValidate?: (decoded: unknown) => ValidationResult;
  readonly readOnly?: boolean;
}

// ── Defaults ────────────────────────────────────────────────

const DEFAULT_POLICY: ObserverPolicy = {
  version: 1,
  rules: [],
};

// ── Component ───────────────────────────────────────────────

export function ObserverPolicyEditor(
  props: ObserverPolicyEditorProps,
): ReactElement {
  const initial = props.initialPolicy ?? DEFAULT_POLICY;
  const [draft, setDraft] = useState<string>(() =>
    JSON.stringify(initial, null, 2),
  );
  const [validation, setValidation] = useState<ValidationResult>({
    valid: true,
  });
  const [dirty, setDirty] = useState<boolean>(false);

  // Re-seed the draft when the parent passes a new initialPolicy.
  // This is intentional: opening a different policy in the same
  // editor instance should reset the buffer.
  useEffect(() => {
    setDraft(JSON.stringify(initial, null, 2));
    setDirty(false);
    setValidation({ valid: true });
  }, [initial]);

  const validate = useCallback((): ValidationResult => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(draft);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid JSON";
      const result: ValidationResult = { valid: false, message };
      setValidation(result);
      return result;
    }
    let result: ValidationResult = baseShapeCheck(decoded);
    if (result.valid && props.onValidate) {
      const custom = props.onValidate(decoded);
      result = custom;
    }
    setValidation(result);
    return result;
  }, [draft, props]);

  const onChange = useCallback((next: string) => {
    setDraft(next);
    setDirty(true);
    setValidation({ valid: true });
  }, []);

  const onPrettyPrint = useCallback(() => {
    try {
      const decoded = JSON.parse(draft);
      setDraft(JSON.stringify(decoded, null, 2));
      setValidation({ valid: true });
    } catch (err) {
      setValidation({
        valid: false,
        message: err instanceof Error ? err.message : "Invalid JSON",
      });
    }
  }, [draft]);

  const onSave = useCallback(() => {
    const result = validate();
    if (!result.valid) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(draft);
    } catch {
      return;
    }
    if (!isPolicyShape(decoded)) {
      setValidation({
        valid: false,
        message: "Policy must have { version: number, rules: array }",
      });
      return;
    }
    props.onSave?.(decoded);
    setDirty(false);
  }, [draft, props, validate]);

  const lineCount = useMemo(() => draft.split("\n").length, [draft]);

  return (
    <div
      data-testid="observer-policy-editor"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "var(--space-sm, 8px) var(--space-md, 12px)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm, 8px)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "var(--font-size-2xs, 10px)",
            color: "var(--color-text-secondary)",
          }}
        >
          {lineCount} {lineCount === 1 ? "line" : "lines"}
          {dirty ? " · modified" : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onPrettyPrint}
          disabled={props.readOnly === true}
          className="btn-press"
          style={btnStyle(props.readOnly === true)}
        >
          Pretty-print
        </button>
        <button
          type="button"
          onClick={validate}
          className="btn-press"
          style={btnStyle(false)}
        >
          Validate
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={props.readOnly === true || !dirty || !validation.valid}
          className="btn-press"
          style={{
            ...btnStyle(
              props.readOnly === true || !dirty || !validation.valid,
            ),
            background:
              !props.readOnly && dirty && validation.valid
                ? "var(--color-primary)"
                : "var(--surface-2)",
            color:
              !props.readOnly && dirty && validation.valid
                ? "#fff"
                : "var(--color-text-muted)",
            borderColor:
              !props.readOnly && dirty && validation.valid
                ? "transparent"
                : "var(--border-subtle)",
          }}
        >
          Save
        </button>
      </div>

      {!validation.valid && validation.message && (
        <div
          role="alert"
          data-testid="observer-policy-error"
          style={{
            margin: "var(--space-sm, 8px)",
            padding: "var(--space-sm, 8px) var(--space-md, 12px)",
            background: "var(--color-error-bg, rgba(239, 68, 68, 0.08))",
            color: "var(--color-error, #ef4444)",
            borderRadius: "var(--radius-sm, 6px)",
            fontSize: "var(--font-size-xs, 11px)",
          }}
        >
          {validation.message}
        </div>
      )}
      {validation.valid && (
        <div
          aria-live="polite"
          style={{
            margin: "var(--space-sm, 8px)",
            padding: "var(--space-xs, 6px) var(--space-md, 12px)",
            color: "var(--color-success, #34c759)",
            fontSize: "var(--font-size-xs, 11px)",
            display: dirty ? "block" : "none",
          }}
        >
          JSON parses cleanly. Click Save to apply.
        </div>
      )}

      <textarea
        aria-label="Observer policy JSON"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        readOnly={props.readOnly === true}
        spellCheck={false}
        data-testid="observer-policy-textarea"
        style={{
          flex: 1,
          width: "100%",
          minHeight: 0,
          padding: "var(--space-md, 12px)",
          background: "var(--bg-base, transparent)",
          color: "var(--color-text-primary)",
          border: "none",
          outline: "none",
          resize: "none",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-xs, 11px)",
          lineHeight: 1.5,
        }}
      />
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: "var(--font-size-2xs, 10px)",
    fontWeight: 600,
    borderRadius: "var(--radius-sm, 6px)",
    border: "1px solid var(--border-subtle)",
    background: "var(--surface-2)",
    color: "var(--color-text-secondary)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

function baseShapeCheck(decoded: unknown): ValidationResult {
  if (!isPolicyShape(decoded)) {
    return {
      valid: false,
      message: "Policy must have { version: number, rules: array }",
    };
  }
  for (const rule of decoded.rules) {
    if (
      !rule ||
      typeof rule !== "object" ||
      typeof (rule as { id?: unknown }).id !== "string"
    ) {
      return {
        valid: false,
        message: "Each rule must have an id (string)",
      };
    }
    const action = (rule as { action?: unknown }).action;
    if (
      action !== "allow" &&
      action !== "deny" &&
      action !== "warn" &&
      action !== "log"
    ) {
      return {
        valid: false,
        message: `Rule ${(rule as { id: string }).id} has unknown action: ${String(action)}`,
      };
    }
  }
  return { valid: true };
}

function isPolicyShape(decoded: unknown): decoded is ObserverPolicy {
  if (!decoded || typeof decoded !== "object") return false;
  const o = decoded as Record<string, unknown>;
  if (typeof o["version"] !== "number") return false;
  if (!Array.isArray(o["rules"])) return false;
  return true;
}
