# Phase 7 DSPy + GEPA Self-Evolution — Progress

**Target scope**: 20 days (CRITICAL PATH). Foundation shipped this session.

## Shipped

| Item | Status | Commit |
|---|---|---|
| GEPA optimizer core (generic genetic evolution) | ✅ | (this commit) |

## Remaining (scope for v0.5.0+)

| Tier | Item | Est |
|---|---|---|
| 1 | Skill-prompt optimization loop (wire GEPA to `src/skills/skill-forge.ts`) | 2d |
| 2 | Tool-description optimization (wire to `src/prompt/model-formatter.ts`) | 2d |
| 3 | Prompt-section optimization (wire to `src/prompt/system-prompt-engine.ts`) | 3d |
| 4 | Darwinian Evolver for code mutations (AST-level) | 5d |
| — | MIPROv2 fallback (when GEPA's LLM budget exceeded) | 2d |
| — | Benchmark harness integration (evaluate = run target benchmark subset) | 2d |
| — | Convergence tuning + hyperparameter sweep | 2d |
| — | UI for viewing evolution history | 2d |

## How it composes

```
wotann optimize-skill <skill-name> --budget=$5
  ↓
GEPA.optimize({
  initialPopulation: [currentSkillPrompt],
  mutate: (parent, n) => llmRewriteSkill(parent.value, n),  // Tier 1
  evaluate: (cand) => runBenchSubset(skill=cand.value).passRate,
  populationSize: 6,
  maxGenerations: 10,
  patience: 3,
})
  ↓
writes improved skill back, if fitness > baseline + threshold
```

Same pattern for tools (`mutate = llmRewriteToolDescription`), prompt sections (`mutate = llmRewriteSection`), and code (`mutate = astMutateOrLlmRewrite`).

## Quality bar check

- **Deterministic given seed**: ✅ `random` callback injectable
- **No LLM calls inside module**: ✅ caller provides mutate + evaluate
- **Memoization via Promise cache**: ✅ concurrent duplicates share one eval
- **Immutable candidate state**: ✅ evaluateCached returns new object
- **TDD**: 15 tests, red-before-green

## Ship target

GEPA core lands in v0.4.0 as usable library. Fully-wired tier-1/2/3/4 optimization lands in v0.5.0.
