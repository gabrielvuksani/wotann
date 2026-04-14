---
name: frontend-design-system
description: DESIGN.md-driven frontend styling workflow with real-site archetypes, component rules, and responsive guardrails
context: fork
paths: ["**/*.tsx", "**/*.jsx", "**/*.css", "**/*.scss"]
not_for: ["**/*.test.*", "**/*.spec.*"]
category: frontend
---

# Frontend Design System

## Core Pattern
- Treat design direction as a written system, not a pile of isolated tweaks.
- Define the interface in the same order used by DESIGN.md workflows:
  1. Visual theme and atmosphere
  2. Color palette and semantic roles
  3. Typography hierarchy
  4. Component styling rules
  5. Layout and spacing principles
  6. Depth and elevation
  7. Do and do-not rules
  8. Responsive behavior
  9. Agent build prompt

## Style Selection
- Pick a clear archetype before building: editorial minimalism, terminal-native, cinematic dark, blueprint-technical, premium whitespace, or warm product marketing.
- Keep the archetype consistent across color, type, spacing, and motion.
- Use reference-site energy as a direction, not a pixel copy.

## Execution Rules
- Name color roles semantically; avoid raw hexes scattered through components.
- Define a deliberate type scale with strong heading/body contrast.
- Specify component states for buttons, cards, nav, inputs, and empty states.
- Design mobile collapse behavior up front instead of shrinking desktop layouts.
- End with a short anti-pattern list so the UI does not drift toward generic SaaS defaults.
