---
name: api-design
description: REST vs GraphQL, response formats, versioning, pagination
context: fork
paths: ["**/routes/**", "**/api/**", "**/controllers/**"]
---

# API Design

## Decision Framework
- **REST**: Standard CRUD, public APIs, caching-heavy, simple relationships.
- **GraphQL**: Complex nested data, mobile clients, multiple frontends.
- **tRPC**: Internal APIs, TypeScript end-to-end, rapid prototyping.

## REST Conventions
- Use nouns for resources (`/users`, not `/getUsers`).
- Use HTTP methods correctly (GET=read, POST=create, PUT=replace, PATCH=update, DELETE=remove).
- Use plural nouns (`/users/123`, not `/user/123`).
- Use query params for filtering (`/users?role=admin`).
- Return appropriate status codes (200, 201, 204, 400, 401, 403, 404, 500).

## Response Format
Always use consistent envelope:
```json
{
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 20 },
  "error": null
}
```

## Pagination
- Use cursor-based pagination for large datasets.
- Use offset-based only for simple cases with stable data.
- Always include total count in meta.

## Versioning
- URL path versioning (`/v1/users`) for public APIs.
- Header versioning for internal APIs.
- Never remove fields, only add (backward compatibility).
