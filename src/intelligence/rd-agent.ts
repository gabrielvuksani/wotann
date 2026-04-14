/**
 * RD-Agent — automated research and development loops.
 * Inspired by Microsoft Qlib's RD-Agent: hypothesis → experiment → evaluate → keep/discard.
 */

// ── Types ────────────────────────────────────────────────

export interface RDExperiment {
  readonly id: string;
  readonly hypothesis: string;
  readonly approach: string;
  readonly status: "pending" | "running" | "evaluating" | "completed" | "failed";
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly metrics: Readonly<Record<string, number>>;
  readonly result: "keep" | "discard" | "inconclusive" | null;
  readonly notes: string;
}

export interface RDConfig {
  readonly maxExperiments: number;
  readonly timeoutMs: number;
  readonly evaluationCriteria: readonly EvaluationCriterion[];
}

export interface EvaluationCriterion {
  readonly name: string;
  readonly metric: string;
  readonly threshold: number;
  readonly direction: "higher_better" | "lower_better";
}

export interface RDReport {
  readonly objective: string;
  readonly experiments: readonly RDExperiment[];
  readonly bestResult: RDExperiment | null;
  readonly totalDurationMs: number;
  readonly improvementPercent: number;
}

// ── RD Agent ─────────────────────────────────────────────

export class RDAgent {
  private readonly experiments: RDExperiment[] = [];
  private readonly config: RDConfig;

  constructor(config?: Partial<RDConfig>) {
    this.config = {
      maxExperiments: 10,
      timeoutMs: 300_000, // 5 minutes per experiment
      evaluationCriteria: [
        { name: "accuracy", metric: "accuracy", threshold: 0.05, direction: "higher_better" },
        { name: "latency", metric: "latency_ms", threshold: -100, direction: "lower_better" },
      ],
      ...config,
    };
  }

  /**
   * Run an R&D loop on a given objective.
   * Returns a report of all experiments and the best result.
   */
  async *runLoop(
    objective: string,
    generateHypothesis: (context: string) => Promise<string>,
    runExperiment: (hypothesis: string) => Promise<Record<string, number>>,
    evaluate: (metrics: Record<string, number>) => "keep" | "discard" | "inconclusive",
  ): AsyncGenerator<RDExperiment> {
    const startTime = Date.now();
    let bestMetrics: Record<string, number> = {};
    let context = `Objective: ${objective}\nPrevious experiments: none`;

    for (let i = 0; i < this.config.maxExperiments; i++) {
      // 1. Generate hypothesis
      const hypothesis = await generateHypothesis(context);

      const experiment: RDExperiment = {
        id: `exp-${Date.now()}-${i}`,
        hypothesis,
        approach: `Experiment ${i + 1}`,
        status: "running",
        startedAt: Date.now(),
        metrics: {},
        result: null,
        notes: "",
      };
      this.experiments.push(experiment);
      yield experiment;

      // 2. Run experiment
      try {
        const metrics = await runExperiment(hypothesis);

        // 3. Evaluate
        const result = evaluate(metrics);

        const completed: RDExperiment = {
          ...experiment,
          status: "completed",
          completedAt: Date.now(),
          metrics,
          result,
          notes: result === "keep" ? "Improvement found" : result === "discard" ? "No improvement" : "Inconclusive",
        };

        // Replace in array
        const idx = this.experiments.findIndex((e) => e.id === experiment.id);
        if (idx >= 0) this.experiments[idx] = completed;

        yield completed;

        // Update context for next iteration
        if (result === "keep") {
          bestMetrics = { ...bestMetrics, ...metrics };
        }
        context = `Objective: ${objective}\nBest metrics so far: ${JSON.stringify(bestMetrics)}\nLast result: ${result} (${JSON.stringify(metrics)})`;

      } catch (err) {
        const failed: RDExperiment = {
          ...experiment,
          status: "failed",
          completedAt: Date.now(),
          result: "discard",
          notes: err instanceof Error ? err.message : "Unknown error",
        };
        const idx = this.experiments.findIndex((e) => e.id === experiment.id);
        if (idx >= 0) this.experiments[idx] = failed;
        yield failed;
      }

      // Check total time budget
      if (Date.now() - startTime > this.config.timeoutMs * this.config.maxExperiments) break;
    }
  }

  /**
   * Generate a summary report of all experiments.
   */
  getReport(objective: string): RDReport {
    const completed = this.experiments.filter((e) => e.status === "completed");
    const kept = completed.filter((e) => e.result === "keep");

    const bestResult = kept.length > 0
      ? kept.reduce((best, current) => {
          const bestTotal = Object.values(best.metrics).reduce((s, v) => s + v, 0);
          const currentTotal = Object.values(current.metrics).reduce((s, v) => s + v, 0);
          return currentTotal > bestTotal ? current : best;
        })
      : null;

    const firstMetrics = Object.values(this.experiments[0]?.metrics ?? {}).reduce((s, v) => s + v, 0);
    const lastMetrics = Object.values(bestResult?.metrics ?? {}).reduce((s, v) => s + v, 0);
    const improvement = firstMetrics > 0 ? ((lastMetrics - firstMetrics) / firstMetrics) * 100 : 0;

    return {
      objective,
      experiments: this.experiments,
      bestResult,
      totalDurationMs: this.experiments.reduce((sum, e) => sum + ((e.completedAt ?? Date.now()) - e.startedAt), 0),
      improvementPercent: improvement,
    };
  }

  /**
   * Reset for a new R&D session.
   */
  reset(): void {
    this.experiments.length = 0;
  }
}
