---
name: dotnet-core
description: .NET 8, minimal APIs, Entity Framework Core, Blazor, ASP.NET Core
context: fork
paths: ["**/*.csproj", "**/Program.cs", "**/*.cs"]
requires:
  bins: ["dotnet"]
---

# .NET Core

## When to Use
- Building or reviewing a .NET 8+ application (API, Blazor, worker, console).
- Designing minimal APIs or converting controllers to minimal APIs.
- EF Core model / migration / query-performance work.
- Implementing CQRS with MediatR or source-generated alternatives.
- Diagnosing allocations, GC pressure, or async-deadlock bugs.

## Rules
- Nullable reference types enabled project-wide; `<Nullable>enable</Nullable>`.
- Use minimal APIs for simple endpoints; controllers only when model binding or filters justify.
- Return `IResult` / `Results.*` from minimal endpoints for typed responses.
- Use `async`/`await` all the way; never `.Result` or `.Wait()` on async code.
- Use `record` types for DTOs and value objects; keep them immutable.
- EF Core: `AsNoTracking()` for reads; explicit `Include`/`ThenInclude` over lazy loading.

## Patterns
- **Vertical slice architecture** — each feature is a folder with its request, handler, validator, endpoint.
- **MediatR** (or source-gen) for CQRS — request → handler.
- **FluentValidation** for input validation.
- **Output caching + response compression** for static-ish endpoints.
- **Health checks** with `AddHealthChecks()` + `/healthz` endpoint.
- **`IHostedService`** for background jobs; upgrade to Quartz.NET if complex.

## Example
```csharp
// Program.cs — minimal API with validation and typed result.
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddValidatorsFromAssemblyContaining<Program>();
builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Db")));
var app = builder.Build();

app.MapPost("/users", async (CreateUserRequest req, IValidator<CreateUserRequest> v, AppDb db) =>
{
    var result = await v.ValidateAsync(req);
    if (!result.IsValid) return Results.ValidationProblem(result.ToDictionary());

    var user = new User(req.Email);
    db.Users.Add(user);
    await db.SaveChangesAsync();
    return Results.Created($"/users/{user.Id}", user);
});

app.Run();
```

## Checklist
- [ ] Nullable reference types enabled; no `#nullable disable`.
- [ ] Async all the way down; no `.Result` or `.Wait()`.
- [ ] EF queries use `AsNoTracking()` where appropriate.
- [ ] Validation at the edge (FluentValidation or data annotations).
- [ ] Health check + structured logging + OpenTelemetry wired.

## Common Pitfalls
- **Sync-over-async** in library code (`.Result`) — deadlocks under load.
- **Lazy loading** in EF causing N+1 queries without visibility.
- **DI lifetime mismatch** — scoped service injected into singleton.
- **Missing `ConfigureAwait(false)`** in library code running in sync contexts.
- **Over-applying MediatR** to trivial CRUD — boilerplate with no benefit.
