---
name: event-driven
description: Event sourcing, CQRS, message queues, pub/sub
context: fork
paths: []
---
# Event-Driven Architecture
## Rules
- Events are immutable facts about what happened.
- Consumers are idempotent (safe to replay events).
- Event schemas are versioned (backward-compatible).
- Dead letter queues for unprocessable messages.
## Patterns
- Event sourcing: rebuild state from event stream.
- CQRS: separate read/write models for optimal performance.
- Pub/sub: decouple producers from consumers.
- Event-driven saga: coordinate distributed workflows.
## Technologies
- Kafka for high-throughput event streaming.
- RabbitMQ for task queues with routing.
- Redis Streams for lightweight event processing.
