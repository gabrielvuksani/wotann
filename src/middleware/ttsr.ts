/**
 * TTSR — Time-Traveling Streamed Rules.
 * Intercepts model output mid-stream via regex triggers.
 * Rules fire DURING generation, not before or after.
 * Zero upfront context cost — rules only consume tokens when triggered.
 */

export type TTSRSeverity = "critical" | "warning" | "info";

export interface TTSRRule {
  readonly trigger: RegExp;
  readonly injection: string;
  readonly severity: TTSRSeverity;
  readonly maxFiresPerSession: number;
  firedCount: number;
}

export interface TTSRResult {
  readonly modified: string;
  readonly injections: readonly string[];
  readonly shouldAbort: boolean;
  readonly retrySystemMessage?: string;
}

export class TTSREngine {
  private readonly rules: TTSRRule[];

  constructor(customRules?: readonly TTSRRule[]) {
    this.rules = customRules
      ? [...customRules]
      : TTSREngine.defaultRules();
  }

  static defaultRules(): TTSRRule[] {
    return [
      {
        trigger: /TODO|FIXME|HACK/,
        injection: "\n[TTSR] You wrote a TODO/FIXME. Implement it now, don't leave stubs.\n",
        severity: "warning",
        maxFiresPerSession: 3,
        firedCount: 0,
      },
      {
        // Note: this regex detects `any` type assertions in TypeScript code output,
        // not in runtime code. TTSR rules scan model-generated code for anti-patterns.
        trigger: /\bany\b\s+as\s+\w+|\/\/\s*@ts-ignore/,
        injection: "\n[TTSR] Type assertion detected. Use proper typing instead.\n",
        severity: "warning",
        maxFiresPerSession: 2,
        firedCount: 0,
      },
      {
        trigger: /console\.log\(/,
        injection: "\n[TTSR] Replace console.log with structured logger.\n",
        severity: "info",
        maxFiresPerSession: 1,
        firedCount: 0,
      },
      {
        trigger: /password\s*=\s*['"][^'"]+['"]/,
        injection: "\n[TTSR] CRITICAL: Hardcoded password detected! Use environment variables.\n",
        severity: "critical",
        maxFiresPerSession: 5,
        firedCount: 0,
      },
      {
        trigger: /\.innerHTML\s*=/,
        injection: "\n[TTSR] XSS risk: use textContent or a sanitizer instead of innerHTML.\n",
        severity: "critical",
        maxFiresPerSession: 2,
        firedCount: 0,
      },
    ];
  }

  /**
   * Process a chunk of streaming model output.
   * Returns the chunk (unmodified) plus any triggered injections.
   */
  processChunk(chunk: string): TTSRResult {
    const injections: string[] = [];
    const criticalInjections: string[] = [];

    for (const rule of this.rules) {
      if (rule.firedCount >= rule.maxFiresPerSession) continue;
      if (rule.trigger.test(chunk)) {
        injections.push(rule.injection);
        rule.firedCount++;
        if (rule.severity === "critical") {
          criticalInjections.push(rule.injection);
        }
      }
    }

    const hasCritical = criticalInjections.length > 0;

    // Only abort on critical severity injections; warnings and info are advisory only
    return {
      modified: chunk,
      injections,
      shouldAbort: hasCritical,
      retrySystemMessage: hasCritical
        ? [
          "TTSR RETRY SYSTEM MESSAGE",
          "The previous streaming attempt was aborted because it emitted one of the following critical patterns:",
          ...criticalInjections,
          "Restart the response from scratch and do not repeat the flagged patterns.",
        ].join("\n")
        : undefined,
    };
  }

  /**
   * Reset fire counts for a new session.
   */
  reset(): void {
    for (const rule of this.rules) {
      rule.firedCount = 0;
    }
  }

  /**
   * Add a custom rule at runtime.
   */
  addRule(rule: TTSRRule): void {
    this.rules.push(rule);
  }

  getRules(): readonly TTSRRule[] {
    return this.rules;
  }
}
