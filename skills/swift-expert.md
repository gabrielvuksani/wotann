---
name: swift-expert
description: SwiftUI, async/await, protocol-oriented design for iOS/macOS/watchOS
context: fork
paths: ["**/*.swift", "**/Package.swift"]
requires:
  bins: ["swift"]
---

# Swift Expert

## When to Use

- Building the WOTANN iOS companion (Swift side in `src/mobile/` bridging to Expo).
- Writing macOS Desktop Control utilities that interact with system frameworks.
- Implementing SwiftUI views with @Observable macro (iOS 17+).
- Migrating Combine-based async to structured `async/await` with AsyncSequence.
- Adding watchOS companion surfaces for Relay notifications.

## Rules

- SwiftUI for new UI; UIKit only for legacy screens or missing SwiftUI APIs.
- `async/await` for all async work — no completion handlers in new code.
- Value types (`struct`, `enum`) by default; reference types only for identity/reference semantics.
- Protocol-oriented over class inheritance.
- Use `Sendable` conformance and actors to keep data-race safety checks green.
- No `!` force-unwraps in production; prefer `guard let` / `if let` / `??`.

## Patterns

- **MVVM**: `@Observable` (iOS 17+) for view models; `@State` for local UI state.
- **Structured concurrency**: `TaskGroup`, `async let`, cancellation via `Task.isCancelled`.
- **Environment**: `@Environment(\.key)` for dependency injection, not singletons.
- **Result builders**: custom DSLs for HTML, navigation, or config.
- **Actors**: isolate mutable state; main actor for UI-bound view models.

## Example

```swift
@Observable
final class RelayViewModel {
    private(set) var relays: [Relay] = []
    private let client: RelayClient

    init(client: RelayClient) { self.client = client }

    func load() async {
        do {
            relays = try await client.fetchRelays()
        } catch {
            relays = []
        }
    }
}

struct RelayList: View {
    @State private var model = RelayViewModel(client: .live)

    var body: some View {
        List(model.relays) { Text($0.title) }
            .task { await model.load() }
    }
}
```

## Checklist

- [ ] No force-unwraps (`!`) in changed files.
- [ ] All async paths use `async/await`, not completion handlers.
- [ ] View models isolated with `@Observable` or actors for mutable state.
- [ ] Tested on a physical device (Gabriel's iPhone), not just simulator.

## Common Pitfalls

- Capturing `self` strongly in `Task { ... }`; use `[weak self]` when needed.
- Assuming simulator parity for Haptics/Keychain; real-device behavior differs.
- Using `DispatchQueue.main.async` instead of `await MainActor.run { }` in async context.
