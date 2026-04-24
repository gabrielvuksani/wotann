# WOTANN Benchmarks

Public benchmark runs for WOTANN's memory + retrieval stack. Updated
nightly by `.github/workflows/benchmark-nightly.yml` when the prereq
secrets are configured; otherwise this page stays at the last good
snapshot.

## LongMemEval (Wu et al., ICLR 2025)

500-instance memory retrieval benchmark. WOTANN targets a score within
2-5% of Mastra's 94.87% (per V9 Tier 2 §T2.3) once T1.3 (sqlite-vec
activation) + T1.4 (ONNX cross-encoder) + a Claude Haiku judge are
active on the runner.

### Configuration

- **Retrieval stack**: TEMPR (4-channel: vector + BM25 + entity +
  temporal) with ONNX MiniLM cross-encoder rerank (when available)
  else heuristic fallback.
- **Vector backend**: `sqlite-vec` native KNN when the extension is
  available; FTS5 + cosine fallback otherwise.
- **Judge model**: configured via `LONGMEMEVAL_JUDGE_KEY` repo secret.
- **Variant**: `s` (115k-token history) by default; run manually with
  `workflow_dispatch` + `variant=m|oracle` to override.
- **Gates active on benchmark runs**:
  - `WOTANN_OMEGA_LAYERS=1`
  - `WOTANN_USE_TEMPR=1`
  (Both now default-ON as of V9 T2.3 shipped in commit `68d7063`.)

### Regression policy

The workflow fails if a run scores more than 5% below the rolling
median of the last 7 runs. See `scripts/benchmark-regression-gate.mjs`
(TODO: ship the gate script in a follow-up commit alongside the
benchmark CLI wrapper).

### Historical results

| Date (UTC) | Variant | Score | Instances | Notes |
|---|---|---|---|---|
| _pending first run_ | s | — | — | Workflow shipped in V9 T2.4 ({commit}); first scheduled run will populate this row. |

### Reproducing locally

```bash
# 1. Download the corpus (one-time, licensed).
node scripts/download-longmemeval.mjs --yes

# 2. Set a judge model API key.
export LONGMEMEVAL_JUDGE_KEY=sk-ant-...

# 3. Build + run.
npm run build
node scripts/benchmark-longmemeval.mjs --variant=s
```

### Known gaps

- **Scorer is rule-based** (per V9 T2.2 deferred). The nightly
  workflow still ships + commits results but scores reflect
  deterministic matching — not LLM-judge nuance. T2.2's LLM-judge
  upgrade is a follow-up task.
- **Corpus auto-download disabled in CI**: the downloader requires
  `--yes` license confirmation. The workflow passes `--yes`; forks
  without the `LONGMEMEVAL_JUDGE_KEY` secret short-circuit before
  touching the download step so the license flag never auto-fires on
  uninitialized forks.
- **Benchmark CLI wrapper** (`scripts/benchmark-longmemeval.mjs`) and
  **docs updater** (`scripts/update-benchmarks-md.mjs`) are referenced
  by the workflow but not yet implemented — a follow-up commit will
  add them. The workflow already skips gracefully when `npm run
  build` or these scripts don't produce output.

---

_Last generated: 2026-04-23 — V9 T2.4 workflow + page scaffold_
