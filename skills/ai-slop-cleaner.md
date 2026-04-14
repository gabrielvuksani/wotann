---
name: ai-slop-cleaner
description: Remove AI over-engineering, stubs, wrappers, and premature abstractions
context: fork
paths: []
---

# AI Slop Cleaner

## When to Use

- Reviewing code generated in an earlier WOTANN session for unnecessary complexity.
- After a multi-agent feature where each agent added "just in case" abstractions.
- Before merging a PR that smells over-engineered (too many interfaces, wrappers).
- When tests are passing but the code feels inflated relative to the requirement.
- During a periodic WOTANN hygiene sweep in `src/` modules touched by multiple sessions.

## Rules

- Deletion-first: every cleanup starts by removing code, not rewriting it.
- Regression-safety: run the full test suite after each deletion; revert on failure.
- Keep AI-added tests if they pass; they become the safety net for future refactors.
- Never delete something that has an active consumer; search references first.
- Do not substitute "clean" for "terse"; clarity beats minimalism.
- Commit per deletion so each change is independently revertable.

## Patterns

- **Inline single-use abstractions**: factory for one class -> direct constructor call.
- **Kill try/catch cargo cult**: remove try/catch wrapping infallible operations.
- **Strip obvious comments**: `// increment counter` next to `counter++` adds nothing.
- **Delete stubs**: `TODO: implement` or `throw NotImplemented` in shipped code.
- **Collapse wrapper functions**: `foo() { return bar(); }` -> call `bar` directly.

## Example

Before (AI-generated slop in `src/providers/router.ts`):
```typescript
class ProviderFactory {
  createClaudeProvider(config: any): ClaudeProvider {
    try { return new ClaudeProvider(config); }
    catch (e) { throw e; }
  }
}
```

After cleanup:
```typescript
const provider = new ClaudeProvider(config);
```

## Checklist

- [ ] Full test suite passes after each deletion commit.
- [ ] No stub/TODO/`throw NotImplemented` remains in the touched files.
- [ ] Single-consumer abstractions inlined or justified with a comment.
- [ ] Git log shows one deletion per commit for easy revert.

## Common Pitfalls

- Deleting an abstraction that protects against a planned second consumer; check the roadmap first.
- Stripping a comment that explained non-obvious business rules ("counter is 1-indexed for legacy API").
- Inlining a wrapper that exists for test seams; check test imports before collapsing.
