---
name: angular-architect
description: Angular 17+, standalone components, signals, deferred loading
context: fork
paths: ["**/*.component.ts", "**/angular.json", "**/*.module.ts"]
requires:
  bins: ["node", "ng"]
---

# Angular Architect

## When to Use
- Building or reviewing an Angular 17+ application.
- Migrating from NgModule-based to standalone components.
- Refactoring RxJS-heavy code to use signals where appropriate.
- Splitting bundles with `@defer` and route-level lazy loading.
- Debugging change detection or performance issues in Angular.

## Rules
- Default to **standalone components**. Reach for NgModules only when a library requires them.
- Use **signals** for component-local state; keep RxJS for event streams and async flows.
- Use `inject()` in constructors; it plays well with signals and makes tree-shaking cleaner.
- Prefer `@if`, `@for`, `@defer` control flow over `*ngIf`/`*ngFor`.
- Typed reactive forms (`FormGroup<T>`) — no untyped form values.
- Enable strict mode + strict templates in `tsconfig`.

## Patterns
- **Smart / dumb** component separation — container + presentational.
- **Route-level lazy loading** with `loadComponent` and preloading strategy.
- **`@defer`** blocks for below-the-fold or heavy content.
- **Functional interceptors / guards / resolvers** — no more class-based boilerplate.
- **Signal inputs / outputs** for parent-child communication without ChangeDetectorRef.

## Example
```ts
import { Component, computed, signal } from "@angular/core";

@Component({
  selector: "app-counter",
  standalone: true,
  template: `
    <button (click)="inc()">+</button>
    <button (click)="dec()">-</button>
    <p>Count: {{ count() }} (double: {{ doubled() }})</p>
  `,
})
export class CounterComponent {
  readonly count = signal(0);
  readonly doubled = computed(() => this.count() * 2);
  inc() { this.count.update((v) => v + 1); }
  dec() { this.count.update((v) => v - 1); }
}
```

## Checklist
- [ ] Components are standalone unless library constraints force NgModule.
- [ ] Signals used for local state; RxJS for streams.
- [ ] Strict mode + strict templates enabled.
- [ ] Routes lazy-loaded; bundle size monitored in CI.
- [ ] `trackBy` provided on every `@for` over dynamic lists.

## Common Pitfalls
- **Overusing RxJS** for simple state — signals are simpler.
- **Missing `trackBy`** causing full re-render on every list change.
- **Deep component trees** without OnPush change detection.
- **Forgetting to mark feature modules as lazy** — big initial bundle.
- **Using `any` in form values** — defeats type safety.
