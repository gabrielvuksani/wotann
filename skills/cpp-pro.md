---
name: cpp-pro
description: Modern C++20/23 with RAII, concepts, ranges, and zero-cost abstractions
context: fork
paths: ["**/*.cpp", "**/*.h", "**/*.hpp", "**/CMakeLists.txt"]
requires:
  bins: ["g++"]
---

# C++ Pro

## When to Use

- Writing high-performance native modules for WOTANN (e.g., SQLite FTS5 extensions).
- Integrating Computer-Use perception engines that need SIMD or raw memory control.
- Reviewing legacy C++03/11 code for modernization to C++20/23.
- Designing header-only libraries with concepts and templates.
- Debugging UB, lifetime, or template instantiation issues.

## Rules

- C++20 minimum; prefer C++23 (`std::expected`, `std::print`, deducing this).
- RAII on every resource; never manual new/delete, never raw `malloc`/`free`.
- Smart pointers: `unique_ptr` by default, `shared_ptr` only for shared ownership.
- No C-style casts (`(T)x`) — use `static_cast`, `const_cast`, `reinterpret_cast`.
- `const` everywhere by default; add mutability only when required.
- Enable `-Wall -Wextra -Wpedantic -Werror` and sanitizers in CI.

## Patterns

- **Concepts over SFINAE**: `template<std::integral T>` is readable and diagnostic-friendly.
- **Ranges/views**: compose lazy pipelines (`std::views::filter | transform | take`).
- **std::expected**: typed errors without exceptions (`std::expected<T, Error>`).
- **Move semantics**: `&&` parameters, `std::move`, rule of zero.
- **Modules**: `import std;` replaces monolithic headers where toolchain supports it.

## Example

```cpp
#include <expected>
#include <ranges>
#include <string>

struct ParseError { std::string what; };

std::expected<int, ParseError> parseInt(std::string_view s) {
    int value{};
    auto [ptr, ec] = std::from_chars(s.data(), s.data() + s.size(), value);
    if (ec != std::errc{}) return std::unexpected(ParseError{"not a number"});
    return value;
}

auto sumValid(std::span<std::string_view> tokens) {
    return tokens
        | std::views::transform(parseInt)
        | std::views::filter([](auto& r) { return r.has_value(); })
        | std::views::transform([](auto& r) { return *r; });
}
```

## Checklist

- [ ] No raw new/delete in changed files.
- [ ] All resource owners use RAII or smart pointers.
- [ ] `-Wall -Wextra -Wpedantic -Werror` clean, UBSan/ASan enabled in CI.
- [ ] No C-style casts; all casts named and scoped.

## Common Pitfalls

- `shared_ptr` cycles leak memory; break with `weak_ptr` on back-pointers.
- Relying on copy elision that the spec doesn't mandate; write moves explicitly.
- Using `std::optional<T&>` (not allowed) — use `T*` or `std::reference_wrapper`.
