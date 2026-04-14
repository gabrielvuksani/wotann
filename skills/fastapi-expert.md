---
name: fastapi-expert
description: FastAPI, Pydantic V2, async, dependency injection, OpenAPI
context: fork
paths: ["**/fastapi*", "**/main.py", "**/*/routers/**"]
requires:
  bins: ["python3"]
---

# FastAPI Expert

## When to Use
- Building or reviewing a FastAPI service.
- Converting Pydantic V1 models to V2, or adopting Pydantic V2 validators.
- Wiring dependency injection for DB sessions, auth, or feature flags.
- Designing OpenAPI-first APIs with client code generation.
- Diagnosing slow endpoints or request queuing under load.

## Rules
- Pydantic V2 models for every request and response — no raw dicts.
- `async def` for I/O-bound endpoints; sync `def` is fine for pure CPU work.
- `Depends()` for all cross-cutting concerns: session, auth, pagination, feature flags.
- `BackgroundTasks` for fire-and-forget work < 1s; Celery / RQ / Arq for anything longer.
- Use `response_model` on every endpoint — sculpts the OpenAPI schema precisely.
- Lifespan events (`asynccontextmanager`) for startup + shutdown — not `on_event`.

## Patterns
- **Router per domain** with its own prefix and tags.
- **Typed dependency graph**: `db: Session = Depends(get_db)`.
- **Pagination dependency** returning `limit` / `offset` / `cursor`.
- **`HTTPException`** plus a global exception handler for uniform error shapes.
- **OpenAPI tags + descriptions** for every router — generate a useful client.

## Example
```py
from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from contextlib import asynccontextmanager

class UserCreate(BaseModel):
    email: EmailStr
    name: str

class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: str

@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_db_pool()
    yield
    await close_db_pool()

app = FastAPI(lifespan=lifespan)

@app.post("/users", response_model=UserOut, status_code=201)
async def create_user(payload: UserCreate, users = Depends(get_users_repo)) -> UserOut:
    if await users.exists(payload.email):
        raise HTTPException(409, "Email already registered")
    return await users.create(payload)
```

## Checklist
- [ ] Pydantic V2 everywhere; no V1 models left.
- [ ] Every endpoint has a typed `response_model`.
- [ ] Lifespan handlers open/close pools cleanly.
- [ ] Async endpoints used for I/O; sync only for pure CPU.
- [ ] OpenAPI tags and descriptions land in the spec.

## Common Pitfalls
- **Sync DB calls in async endpoints** — blocks the event loop.
- **Missing `response_model`** — OpenAPI spec rots.
- **`BackgroundTasks` for long jobs** — lost on worker restart.
- **Using Pydantic V1 API on V2 models** — deprecation warnings become errors in 3.x.
- **Catch-all `except:`** silencing real bugs.
