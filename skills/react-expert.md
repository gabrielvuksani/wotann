---
name: react-expert
description: React 18+ hooks, composition, performance, server components
context: fork
paths: ["**/*.tsx", "**/*.jsx"]
requires:
  bins: ["node"]
---

# React Expert

## Core Principles
- Components are functions. Keep them small (<100 lines).
- Props are the API. Use TypeScript interfaces for all props.
- State belongs where it's used. Lift only when necessary.
- Composition over inheritance. Use children and render props.

## Hooks
- `useState`: Simple local state. Initialize lazily for expensive computations.
- `useReducer`: Complex state with multiple sub-values or transitions.
- `useMemo`/`useCallback`: Only when preventing expensive re-renders (profile first).
- `useRef`: DOM references and mutable values that don't trigger re-renders.
- `useEffect`: Side effects. Cleanup functions prevent memory leaks.

## Performance
- React.memo: Wrap components that receive stable props but re-render often.
- Key strategy: Use stable, unique IDs (never array index for dynamic lists).
- Virtualization: Use react-window/react-virtuoso for lists >100 items.
- Code splitting: React.lazy + Suspense for route-level splitting.

## Anti-Patterns
- useEffect for derived state — compute during render instead.
- Prop drilling >3 levels — use Context or composition.
- Giant components — extract custom hooks and sub-components.
