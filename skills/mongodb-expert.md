---
name: mongodb-expert
description: MongoDB aggregation, indexing, sharding, change streams
context: fork
paths: ["**/mongo*", "**/*.mongo.{js,ts}", "**/models/**/*.{js,ts}"]
---

# MongoDB Expert

## When to Use
- Designing or reviewing MongoDB schemas, collections, or documents.
- Tuning slow queries or diagnosing aggregation pipeline cost.
- Choosing between single-collection, bucketed, or sharded layouts.
- Wiring change streams for event-driven flows or CDC.
- Planning replica-set reads/writes, read-preferences, or read-concerns.

## Rules
- Design schemas around query patterns first; denormalize when it saves roundtrips.
- Use compound indexes that mirror query predicate order (ESR rule: Equality, Sort, Range).
- Prefer aggregation pipelines over application-side joins.
- Use change streams (resumeToken persisted) for real-time reactions, not polling.
- Pin `readConcern: "majority"` for critical reads; use `writeConcern: { w: "majority" }` for durable writes.
- Always size the working set to fit in RAM before scaling out via sharding.

## Patterns
- **Bucketing** for time-series or unbounded arrays: one document per bucket (hour/day).
- **Attribute pattern** for sparse fields: `{ attrs: [{ k, v }] }` with index on `attrs.k`.
- **Outlier pattern** for power-users: move rare large arrays to a separate collection.
- **Subset pattern**: embed the hot subset, reference the cold tail.
- **Schema versioning**: `{ _v: 2, ... }` field so migrations can run lazily.

## Example
```js
// Aggregation: top 5 authors by comment count in the last 7 days.
db.comments.aggregate([
  { $match: { createdAt: { $gte: new Date(Date.now() - 7*864e5) } } },
  { $group: { _id: "$authorId", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 5 },
  { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "u" } },
  { $project: { name: { $arrayElemAt: ["$u.name", 0] }, n: 1 } },
]);
// Index: { createdAt: 1, authorId: 1 } supports the $match + $group prefix.
```

## Checklist
- [ ] Every query predicate has a supporting index (verified via `.explain("executionStats")`).
- [ ] No `COLLSCAN` stages in hot-path `.explain()` output.
- [ ] No unbounded arrays; bucketing or outlier pattern applied.
- [ ] Write concern is explicit; no implicit `w: 1` in critical paths.
- [ ] Schema document includes a `_v` version for future migrations.

## Common Pitfalls
- **Index bloat** from adding indexes without removing redundant prefixes.
- **Unbounded `$where` / `$regex`** that can't use indexes.
- **Over-sharding** before exhausting vertical and replica-set options.
- **Forgetting `$sort` before `$group`** when using `$first/$last` in aggregations.
- **Assuming atomicity** across documents — use transactions or design around single-doc updates.
