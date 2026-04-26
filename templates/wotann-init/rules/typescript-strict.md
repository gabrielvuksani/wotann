# Rule: TypeScript Strict Mode

This project compiles with TypeScript strict mode. Honor it.

## What strict mode requires

- `strict: true` → all of the below
- `noImplicitAny`: every parameter and return type is declared or inferred
- `strictNullChecks`: `T | null | undefined` are distinct from `T`
- `strictFunctionTypes`: function parameters are contravariant
- `strictBindCallApply`: `bind`, `call`, `apply` are typed
- `strictPropertyInitialization`: class fields are initialized in the constructor or marked optional
- `noImplicitThis`: `this` is typed in callbacks
- `alwaysStrict`: every file is parsed in strict mode

## Forbidden patterns

- `any` (use `unknown` and narrow, or define the proper type)
- `// @ts-ignore` (use `// @ts-expect-error` with a one-line justification)
- `as Type` casts that bypass the type system (prefer type guards or `satisfies`)
- Non-null assertions `!` on values that could legitimately be null (use a guard)

## Preferred patterns

- `unknown` for untrusted input → narrow with `typeof`/`instanceof`/`in` or zod
- Discriminated unions for state with multiple shapes
- `readonly` arrays + properties wherever the data is immutable
- `as const` for literal-narrowing
- Result types `{ ok: true, value: T } | { ok: false, error: string }` over thrown exceptions in user-facing APIs

## Examples

WRONG:
```ts
function parse(input: any): any {
  return JSON.parse(input);
}
```

CORRECT:
```ts
function parse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }
}
```
