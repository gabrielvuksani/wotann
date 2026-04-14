---
name: docker-expert
description: Multi-stage builds, image optimization, container security
context: fork
paths: ["**/Dockerfile*", "**/docker-compose*", "**/.dockerignore"]
requires:
  bins: ["docker"]
---

# Docker Expert

## Multi-Stage Builds
Always use multi-stage builds to minimize final image size:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
CMD ["node", "dist/index.js"]
```

## Security
- Never run as root (use `USER node` or `USER 1000`).
- Use `.dockerignore` to exclude secrets, .git, node_modules.
- Pin base image versions (not `latest`).
- Use `--no-install-recommends` for apt.
- Scan images with `docker scout` or `trivy`.

## Optimization
- Order layers by change frequency (dependencies first, code last).
- Use alpine base images when possible.
- Combine RUN commands to reduce layers.
- Use COPY instead of ADD (unless extracting archives).
