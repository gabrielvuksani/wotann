---
name: typescript-pro
description: TypeScript strict mode, generics, type-level programming, no any
context: main
paths: ["**/*.ts", "**/*.tsx"]
requires:
  bins: ["node", "npx"]
---

# TypeScript Pro

## Rules
- NEVER use `any`. Use `unknown` + type guards, generics, or explicit types.
- Enable and respect `strict: true`, `noUncheckedIndexedAccess: true`.
- Prefer `readonly` properties and `ReadonlyArray`/`ReadonlyMap`/`ReadonlySet`.
- Use discriminated unions over optional fields for state machines.
- Use `satisfies` for type-safe object literals without widening.
- Use template literal types for string patterns.

## Patterns
- Error handling: Use `Result<T, E>` pattern or typed `Error` subclasses.
- Immutability: Return new objects from functions, never mutate parameters.
- Type narrowing: Use `in` operator, `instanceof`, and custom type guards.
- Branded types: `type UserId = string & { readonly __brand: unique symbol }`.

## Anti-Patterns
- `as any` or `@ts-ignore` — fix the types instead.
- `Object`, `Function`, `{}` as types — use specific interfaces.
- Excessive type assertions (`as`) — usually means wrong architecture.
- Enums — use `const` objects with `as const` instead.

## Verification
After every change: `npx tsc --noEmit`. Fix ALL errors before moving on.
