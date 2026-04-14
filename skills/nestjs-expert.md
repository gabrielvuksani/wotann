---
name: nestjs-expert
description: NestJS modules, guards, interceptors, DTOs with validation pipes
context: fork
paths: ["**/*.module.ts", "**/*.controller.ts", "**/*.service.ts"]
requires:
  bins: ["node"]
---

# NestJS Expert

## When to Use

- Building a modular Node backend with explicit dependency injection and testability.
- Adding authentication, caching, or request-logging via guards/interceptors.
- Designing a REST or GraphQL API with class-validator DTOs.
- Integrating TypeORM or Prisma with repository-pattern services.
- Splitting a growing Express app into bounded NestJS feature modules.

## Rules

- Use modules as feature boundaries; never import a service across modules without exporting it.
- Every DTO carries `class-validator` decorators; controllers enable `ValidationPipe` globally.
- Guards handle authN/authZ, interceptors handle cross-cutting concerns, pipes transform/validate.
- Never return entity instances directly; map to response DTOs to avoid leaking internals.
- Use `@Injectable({ scope: Scope.DEFAULT })` and avoid request-scoped providers unless needed.
- Use `forwardRef` only when a circular dependency is unavoidable, and document why.

## Patterns

- **Repository pattern**: thin service -> repository -> ORM; service has business logic only.
- **Exception filters**: map domain errors to HTTP status via `@Catch(DomainError)`.
- **Custom decorators**: `@CurrentUser()` extracts user from request context reusably.
- **Config module**: typed `ConfigService` with Joi/Zod schema validation at boot.
- **Testing**: override providers with `Test.createTestingModule().overrideProvider(...)`.

## Example

```typescript
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    const user = await this.users.create(dto);
    return plainToInstance(UserResponseDto, user);
  }
}

export class CreateUserDto {
  @IsEmail() email!: string;
  @MinLength(12) password!: string;
}
```

## Checklist

- [ ] Every controller method has a DTO with validation decorators.
- [ ] No entity leaks into response (all responses are DTO-mapped).
- [ ] Guards + interceptors registered globally or documented per-route.
- [ ] Unit tests override external providers (DB, HTTP) via `TestingModule`.

## Common Pitfalls

- Global `ValidationPipe` missing `whitelist: true, forbidNonWhitelisted: true`; extra fields slip in.
- Putting business logic in controllers instead of services; breaks testability.
- Using `@Req()` directly instead of a DTO; defeats validation entirely.
