---
name: react-native-expert
description: Expo, navigation, native modules, performance for iOS and Android apps
context: fork
paths: ["**/app.json", "**/metro.config*"]
requires:
  bins: ["node", "npx"]
---

# React Native Expert

## When to Use

- Building the WOTANN iOS companion app (`src/mobile/`) with Expo SDK.
- Integrating native modules (Keychain, BGTasks, Haptics) through Expo config plugins.
- Debugging performance regressions on real devices (Gabriel tests on physical hardware).
- Wiring push-to-talk (Voice) or bridge sockets on mobile.
- Migrating legacy RN Classic projects to the Expo managed workflow.

## Rules

- Prefer Expo managed workflow; drop to bare only when a required native module lacks a plugin.
- Never `ScrollView` for unbounded lists; use `FlashList` or `FlatList` with `keyExtractor`.
- Every animation must use `useNativeDriver: true` or Reanimated worklets.
- Test on a physical device before merging — simulator hides GPU/thermal issues.
- No `console.log` in release bundles; strip via Babel transform.
- Images must declare `width`/`height` or ship as `require(...)` with dimensions.

## Patterns

- **Navigation**: Expo Router for file-based routing; React Navigation for deep stack control.
- **State**: Zustand or Jotai for UI state, TanStack Query for server state.
- **Native modules**: Expo config plugins > manual pod/gradle edits.
- **Bridge reduction**: Reanimated worklets run on UI thread, avoiding bridge round-trips.
- **Bundle split**: Hermes + RAM bundles for fast cold start on older devices.

## Example

```tsx
import { FlashList } from '@shopify/flash-list';

export function MessageList({ messages }: { messages: Message[] }) {
  const renderItem = useCallback(
    ({ item }: { item: Message }) => <MessageRow message={item} />,
    []
  );
  return (
    <FlashList
      data={messages}
      renderItem={renderItem}
      keyExtractor={(m) => m.id}
      estimatedItemSize={72}
      drawDistance={300}
    />
  );
}
```

## Checklist

- [ ] Tested on a physical iOS device (not just simulator).
- [ ] All lists use `FlashList`/`FlatList` with `keyExtractor`.
- [ ] Animations run on the native driver or Reanimated worklets.
- [ ] No `console.log` in production build; `__DEV__` gates debug output.

## Common Pitfalls

- Assuming simulator parity; Gabriel's iPhone behaves differently. Always test on device.
- Adding `react-native-*` libs without checking Expo config plugin support.
- Missing `keyExtractor` causes full re-renders on every state change.
