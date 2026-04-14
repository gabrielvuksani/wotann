---
name: performance-profiler
description: Bottleneck detection, profiling, optimization strategies
context: fork
paths: []
---
# Performance Profiler
## Methodology
1. **Measure first**: Profile before optimizing. Use real data.
2. **Identify bottleneck**: Is it CPU, memory, I/O, or network?
3. **Optimize the bottleneck**: Only fix the actual bottleneck.
4. **Measure again**: Verify improvement with same benchmark.
## Tools
- Node.js: clinic.js, 0x (flame graphs), --inspect for Chrome DevTools.
- Python: cProfile, py-spy, memory_profiler.
- Browser: Lighthouse, Performance tab, Web Vitals.
## Common Bottlenecks
- N+1 queries (batch or join).
- Missing database indexes.
- Synchronous I/O in async code.
- Large bundle sizes (code splitting, tree shaking).
- Memory leaks (event listeners, closures, caches without TTL).
