---
name: rust-engineer
description: Ownership, borrowing, lifetimes, zero-cost abstractions
context: fork
paths: ["**/*.rs", "**/Cargo.toml"]
requires:
  bins: ["cargo"]
---
# Rust Engineer
## Rules
- Ownership is the core abstraction. Understand move vs borrow vs clone.
- Prefer `&str` over `String` in function parameters.
- Use `Result<T, E>` for fallible operations, `Option<T>` for nullable values.
- Derive `Debug`, `Clone`, `PartialEq` on most structs.
- Use `clippy` for linting: `cargo clippy -- -D warnings`.
## Patterns
- Builder pattern for complex constructors.
- `impl Trait` for return types (zero-cost dynamic dispatch).
- `enum` + `match` for state machines (exhaustive matching).
- `Arc<Mutex<T>>` for shared mutable state across threads.
## Testing
- Unit tests in the same file with `#[cfg(test)]` module.
- Integration tests in `tests/` directory.
- Property-based testing with `proptest`.
