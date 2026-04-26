# Rule: Conventional Commits

All commit messages follow the Conventional Commits 1.0 spec.

## Format

```
<type>(<optional-scope>): <subject>

<optional-body>

<optional-footer>
```

## Types (use only these)

| Type      | When to use |
|-----------|-------------|
| `feat`    | A new user-facing feature |
| `fix`     | A bug fix |
| `docs`    | Documentation-only change |
| `style`   | Formatting, whitespace, no code change |
| `refactor`| Code change that neither fixes a bug nor adds a feature |
| `perf`    | Performance improvement |
| `test`    | Adding or correcting tests |
| `build`   | Build system, dependencies, packaging |
| `ci`      | CI/CD config |
| `chore`   | Anything that doesn't fit above (release cuts, tooling bumps) |
| `revert`  | Reverting a previous commit |

## Subject rules

- Imperative mood ("add" not "added", "fix" not "fixes")
- No trailing period
- Lowercase first character (unless proper noun)
- Under 72 characters

## Breaking changes

Mark with `!` after the type/scope and add a `BREAKING CHANGE:` footer:

```
feat(auth)!: drop support for legacy session cookies

BREAKING CHANGE: clients on session cookies must migrate to JWT.
```

## Examples

GOOD:
- `feat(palette): add Cmd+Shift+M magic commands shortcut`
- `fix(voice): handle missing OPENAI_API_KEY gracefully`
- `refactor(workspace): extract pure helpers from createWorkspace`
- `docs(recipes): document the Goose-compatible recipe schema`

BAD:
- `Updated stuff` (no type, vague)
- `fix: Fixed the bug.` (period, past tense)
- `WIP` (no type, no description)
