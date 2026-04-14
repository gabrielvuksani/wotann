---
name: svelte-expert
description: SvelteKit, runes, reactivity, server-side rendering with Svelte 5+
context: fork
paths: ["**/*.svelte", "**/svelte.config*"]
requires:
  bins: ["node"]
---

# Svelte Expert

## When to Use

- Building a full-stack SvelteKit app with SSR, endpoints, and form actions.
- Migrating a Svelte 4 codebase to Svelte 5 runes (`$state`, `$derived`, `$effect`).
- Optimizing hydration cost with `export const csr = false` on static pages.
- Implementing authenticated form flows with `use:enhance` and progressive enhancement.
- Wiring a reactive component library to consume Svelte stores.

## Rules

- Svelte 5 runes for all new reactivity; do not mix legacy `$:` labels with runes.
- Data loading lives in `+page.server.ts` or `+page.ts`; never fetch in components.
- Form mutations go through `+page.server.ts` actions with `use:enhance` for progressive enhancement.
- Never import server-only modules into `.svelte` component bodies (leaks to client).
- Prefer `$derived.by(() => ...)` for computations; cache boundaries are explicit.
- Run Vite in preview mode before merging; dev-only drift is common.

## Patterns

- **Runes**: `$state` (mutable), `$derived` (computed), `$effect` (side-effect), `$props` (props).
- **Layouts**: layout groups `(marketing)/+layout.svelte` split concerns without URL segments.
- **Stores**: `writable` + `derived` for cross-component reactive state.
- **Transitions**: `transition:fade`, `transition:fly` built-in — no CSS animation libs needed.
- **Endpoints**: `+server.ts` for JSON APIs colocated with routes.

## Example

```svelte
<script lang="ts">
  let { initial = 0 }: { initial?: number } = $props();
  let count = $state(initial);
  let doubled = $derived(count * 2);

  $effect(() => {
    console.log(`count changed to ${count}`);
  });
</script>

<button onclick={() => count++}>
  {count} (x2 = {doubled})
</button>
```

## Checklist

- [ ] All new reactivity uses runes, not legacy `$:` syntax.
- [ ] Data fetching lives in `+page.server.ts` or `+page.ts`, not components.
- [ ] Forms use `<form action>` + `use:enhance` for progressive enhancement.
- [ ] Server-only imports isolated to `*.server.ts` files.

## Common Pitfalls

- Mixing `$:` and `$state` in the same component — reactivity becomes unpredictable.
- Importing `$env/static/private` in a component body; secrets ship to the browser.
- Forgetting `throw redirect(303, ...)` must be thrown, not returned.
