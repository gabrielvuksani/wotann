---
name: vue-expert
description: Vue 3 Composition API, Pinia, Nuxt 3 with TypeScript-first patterns
context: fork
paths: ["**/*.vue"]
requires:
  bins: ["node"]
---

# Vue Expert

## When to Use

- Building a Vue 3 app with `<script setup>` + TypeScript.
- Adding Pinia stores for shared state across routes.
- Building a Nuxt 3 app with SSR, file-based routing, and server routes.
- Migrating Options API code to Composition API incrementally.
- Composing reusable logic via composables (`use*` functions).

## Rules

- Composition API with `<script setup lang="ts">` only; Options API is legacy.
- Pinia for state (never Vuex); one store per feature.
- `ref()` for primitives, `reactive()` for objects — don't mix the two for the same value.
- Typed `defineProps<{ ... }>()` / `defineEmits<{ ... }>()` — no runtime declarations.
- Use `defineModel()` for two-way binding; avoid prop/emit handshakes.
- Nuxt: avoid `useState` for secrets; use server-only composables.

## Patterns

- **Composables**: extract reusable reactive logic into `useSomething()` functions.
- **Provide/inject**: typed with `InjectionKey<T>` for dependency injection.
- **Teleport**: for modals, tooltips, toasts mounted outside the root DOM tree.
- **Suspense**: wrap async components for loading boundaries.
- **Transitions**: `<Transition name="fade">` with CSS-only animations.

## Example

```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{ initial?: number }>();
const emit = defineEmits<{ change: [value: number] }>();

const count = ref(props.initial ?? 0);
const doubled = computed(() => count.value * 2);

function increment() {
  count.value += 1;
  emit('change', count.value);
}
</script>

<template>
  <button @click="increment">{{ count }} (x2 = {{ doubled }})</button>
</template>
```

## Checklist

- [ ] All components use `<script setup lang="ts">`.
- [ ] State lives in Pinia stores, not `provide/inject` for globals.
- [ ] Props and emits typed with generic declarations.
- [ ] Composables named `useX` and return reactive values only.

## Common Pitfalls

- Destructuring a `reactive()` object loses reactivity; use `toRefs()` first.
- Mutating a prop directly; Vue warns, but it still breaks parent-child contracts.
- Forgetting `.value` when accessing `ref()` outside templates.
