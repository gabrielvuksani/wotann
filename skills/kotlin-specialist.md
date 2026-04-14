---
name: kotlin-specialist
description: Coroutines, Flow, multiplatform, null safety - idiomatic Kotlin patterns
context: fork
paths: ["**/*.kt", "**/build.gradle.kts"]
requires:
  bins: ["kotlin"]
---

# Kotlin Specialist

## When to Use

- Building Android apps or Kotlin Multiplatform projects with shared business logic.
- Writing server-side Kotlin with Ktor, Spring Boot, or Http4k.
- Refactoring Java code to idiomatic Kotlin (leveraging nullability, data classes, extensions).
- Implementing concurrent code with coroutines and Flow.
- Working with `build.gradle.kts` or Gradle version catalogs.

## Rules

- Use null safety rigorously. Avoid `!!` (prefer `?.`, `?:`, `let`, `require`, `checkNotNull`).
- Use `data class` for DTOs (auto-generates equals/hashCode/toString/copy).
- Use `sealed class/interface` for closed type hierarchies (exhaustive `when`).
- Use coroutines for async work (never raw threads, never `Thread.sleep` in suspend).
- Never call `runBlocking` in production code paths (only in main/tests).
- Prefer `val` over `var`; prefer immutable collections (`listOf`, `mapOf`).
- Use extension functions to add behavior without inheritance.

## Patterns

- **Structured concurrency**: scopes own children; cancellation propagates.
- **Flow for streams**: `flow { }` builders, `stateIn`/`shareIn` for hot flows.
- **Result type**: `Result<T>` or `sealed class Either` for typed errors.
- **Scope functions**: `let` (transform), `apply` (configure), `also` (side-effect), `run` (scoped compute).
- **Inline + reified**: zero-cost generic type checks (`inline fun <reified T>`).

## Example

```kotlin
sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>
    data class Success<T>(val data: T) : LoadState<T>
    data class Error(val cause: Throwable) : LoadState<Nothing>
}

fun <T> Flow<T>.asLoadState(): Flow<LoadState<T>> = this
    .map<T, LoadState<T>> { LoadState.Success(it) }
    .onStart { emit(LoadState.Loading) }
    .catch { emit(LoadState.Error(it)) }
```

## Checklist

- [ ] No `!!` operators remain (search `!!` in changed files).
- [ ] All suspend functions live inside a structured `CoroutineScope`.
- [ ] Sealed hierarchies have exhaustive `when` branches (no `else`).
- [ ] Public APIs have explicit nullability and KDoc where non-obvious.

## Common Pitfalls

- Using `GlobalScope.launch` leaks coroutines; use a scoped `viewModelScope` or inject a scope.
- Mutating `MutableStateFlow` from multiple coroutines without synchronization; use `update { }`.
- Forgetting `@JvmStatic` on companion members when Java callers need direct access.
