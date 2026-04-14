---
name: flutter-expert
description: Flutter 3+, Dart, Riverpod, Bloc, widget composition
context: fork
paths: ["**/*.dart", "**/pubspec.yaml"]
requires:
  bins: ["flutter", "dart"]
---
# Flutter Expert
## Rules
- Use Riverpod or Bloc for state management (not setState for complex state).
- Composition over inheritance for widgets.
- Use `const` constructors for performance (reduces rebuilds).
- Extract widgets into separate files when >50 lines.
## Patterns
- Repository pattern for data access.
- GoRouter for declarative navigation.
- Freezed/json_serializable for immutable models.
- Platform channels for native code bridging.
## Testing
- Widget tests with `testWidgets()`.
- Unit tests for business logic.
- Integration tests with `integration_test` package.
