---
name: express-api
description: Express.js REST APIs, middleware, error handling, validation
context: fork
paths: ["**/express*", "**/routes/**", "**/middleware/**", "**/server.{js,ts}"]
requires:
  bins: ["node"]
---

# Express API

## When to Use
- Building or reviewing an Express.js (4 or 5) API.
- Adding auth, validation, rate limiting, or CORS to an existing API.
- Migrating from untyped routes to typed (TypeScript + zod / express-validator).
- Diagnosing slow or leaking endpoints.
- Structuring a medium-sized Express app before it becomes a mess.

## Rules
- TypeScript strict mode. `any` in Express handlers is a bug magnet.
- Validate every input with `zod` / `joi` / `express-validator` — never trust the body.
- Centralize error handling in a single error middleware; never `res.send(err)` ad hoc.
- Use `helmet` for security headers and `cors` (configured per env) — not `app.use(cors())`.
- Wrap async handlers (`asyncHandler(fn)`) — catch rejections into the error middleware.
- Rate-limit public endpoints at the edge OR in the app (`express-rate-limit`).

## Patterns
- **Router per domain**: `/users` router, `/orders` router.
- **Layered architecture**: route → controller → service → repository.
- **Dependency injection via closures** (or `awilix` / `tsyringe` if you prefer containers).
- **Structured logging** with `pino` + request ID correlation.
- **Graceful shutdown**: drain connections on SIGTERM before exit.

## Example
```ts
// Typed, validated, error-handled minimal endpoint.
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";

export const createUserHandler = (users: UserService) => {
  const router = Router();
  const schema = z.object({ email: z.string().email(), name: z.string().min(1) });

  router.post("/users", asyncHandler(async (req, res) => {
    const input = schema.parse(req.body);           // throws → caught by middleware
    const user = await users.create(input);
    res.status(201).json(user);
  }));

  return router;
};

export function asyncHandler<T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: T, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
}
```

## Checklist
- [ ] TypeScript strict + no-unchecked-indexed-access enabled.
- [ ] Every route validates its inputs with a schema.
- [ ] Single central error middleware handles every thrown error.
- [ ] `helmet` + per-env `cors` applied.
- [ ] Graceful shutdown hook (`SIGTERM`) closes the HTTP server.

## Common Pitfalls
- **Missing async error handling** — unhandled rejection crashes the process.
- **`app.use(cors())`** — wide-open CORS in production.
- **Leaking stack traces** to clients in error responses.
- **Long-running handlers** blocking the event loop — offload to worker or queue.
- **Env config** read ad-hoc instead of validated at startup.
