---
name: nextjs-developer
description: App Router, server components, server actions, middleware
context: fork
paths: ["**/next.config*", "**/app/**"]
requires:
  bins: ["node"]
---
# Next.js Developer
## Rules
- Use App Router (not Pages Router for new projects).
- Server Components by default. Add "use client" only when needed.
- Use Server Actions for form submissions and mutations.
- Use `loading.tsx` and `error.tsx` for Suspense boundaries.
## Data Fetching
- Fetch in Server Components (not useEffect).
- Use `cache()` and `revalidatePath/revalidateTag` for ISR.
- Streaming with `<Suspense>` for progressive loading.
## Patterns
- Route groups `(auth)` for layout organization.
- Parallel routes `@modal` for modals.
- Intercepting routes `(..)photo` for soft navigation.
- Middleware for auth, redirects, rewrites.
