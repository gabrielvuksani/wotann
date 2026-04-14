---
name: redis-expert
description: Redis caching, pub/sub, streams, data structures, clustering
context: fork
paths: ["**/redis*", "**/cache/**"]
---

# Redis Expert

## When to Use
- Designing a cache layer (read-through, write-through, cache-aside).
- Choosing between Redis data structures for a workload.
- Building rate-limiters, distributed locks, or leader election.
- Streams (producer/consumer groups), pub/sub, or keyspace notifications.
- Planning sentinel vs cluster vs managed service (ElastiCache, MemoryDB, Upstash).

## Rules
- Pick the right data structure: Hash for objects, Sorted Set for ranked lists, Stream for durable queues.
- TTL on every cache key — unbounded keys leak memory forever.
- Pipeline multiple commands in one round trip when order permits.
- Use Streams over pub/sub for any message that must not be lost.
- Stay under 512MB per key; split large lists/sets/streams by time or hash.
- Persist the right way: AOF for durability, RDB for snapshots, both for safety.

## Patterns
- **Cache-aside**: app reads cache, falls back to DB, writes back with TTL.
- **Sliding-window rate limiter** with a Sorted Set + `ZREMRANGEBYSCORE`.
- **Distributed locks** with Redlock (accept its known tradeoffs).
- **Idempotency keys** stored with TTL for request deduplication.
- **Consumer groups** on Streams for at-least-once processing with ack/claim.

## Example
```lua
-- Atomic sliding-window rate limiter (Lua in Redis).
-- KEYS[1] = bucket key, ARGV[1] = now ms, ARGV[2] = window ms, ARGV[3] = limit
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1] - ARGV[2])
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
```

## Checklist
- [ ] Every cache key has an explicit TTL.
- [ ] `maxmemory-policy` is set (usually `allkeys-lru` for caches).
- [ ] Persistence configured appropriately (AOF + RDB for prod durable).
- [ ] Hot keys identified and split or replicated as needed.
- [ ] Cluster slot count and resharding path documented.

## Common Pitfalls
- **`KEYS *`** in production — blocks the server.
- **Unbounded lists/streams** with no trim policy.
- **Storing large blobs** — move to object storage, keep a pointer in Redis.
- **Treating pub/sub as durable** — lost messages when subscribers disconnect.
- **Trusting OS caching** instead of tuning `maxmemory` explicitly.
