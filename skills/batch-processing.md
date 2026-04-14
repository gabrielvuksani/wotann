# Batch File Processing

Use when: applying the same operation to multiple files simultaneously.
Detects batch-eligible tasks and processes them in parallel with rollback on failure.

## Batch Patterns
1. **Search-and-Replace** — Find pattern across files, replace with new pattern
2. **Migration** — Update API calls, import paths, or config format across codebase
3. **Formatting** — Apply consistent formatting to a set of files
4. **Type Addition** — Add TypeScript types to untyped JavaScript files
5. **Test Generation** — Generate test files for untested source files

## Protocol
1. Detect that the task affects 3+ files with the same type of change
2. Confirm the batch plan with the user (show files + changes preview)
3. Create a shadow git commit BEFORE starting (safe revert point)
4. Process files in parallel (up to 8 concurrent, based on CPU cores)
5. After all files: run typecheck + tests
6. If ANY file fails: git reset to the shadow commit, report which files failed
7. If all pass: keep changes, optionally create a commit

## Rollback Strategy
- Pre-batch: `git stash` or shadow commit
- Per-file: track original content in memory
- Post-batch failure: `git checkout -- <file>` for each failed file
- Full rollback: `git reset --hard <shadow-commit>`

## Parallelism
- Default: min(8, os.cpus().length)
- File-level locking prevents concurrent edits to same file
- Diagnostics (typecheck) run after ALL files are edited, not per-file
