---
name: csharp-developer
description: .NET 8+, minimal APIs, Blazor, Entity Framework with modern C# 12 features
context: fork
paths: ["**/*.cs", "**/*.csproj"]
requires:
  bins: ["dotnet"]
---

# C# Developer

## When to Use

- Building a new .NET 8+ service with minimal APIs or controllers.
- Designing a Blazor Server or WebAssembly app with component composition.
- Writing Entity Framework Core migrations and repository-style data access.
- Migrating older ASP.NET Framework code to modern ASP.NET Core.
- Adding OpenAPI/Swagger, health checks, and structured logging to a service.

## Rules

- .NET 8+ and C# 12 features only (primary constructors, collection expressions).
- Nullable reference types enabled (`<Nullable>enable</Nullable>`) project-wide.
- `async/await` throughout; never `.Result` or `.Wait()` (deadlocks UI threads).
- Use `record` for DTOs and immutable value objects.
- DI via `builder.Services`; never `new` a service inside a controller.
- Every public API surface has XML doc comments consumed by OpenAPI.

## Patterns

- **Minimal APIs** for lightweight services; MVC Controllers for complex routing.
- **Options pattern**: `IOptionsSnapshot<T>` for runtime-refreshable config.
- **Mediator (MediatR)**: thin controllers dispatching to request handlers.
- **EF Core**: migrations via `dotnet ef migrations add`, no DB-first unless forced.
- **Problem Details**: RFC 7807 error body via `builder.Services.AddProblemDetails()`.

## Example

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Db")));

var app = builder.Build();

app.MapGet("/users/{id:guid}", async (Guid id, AppDb db, CancellationToken ct) =>
{
    var user = await db.Users.FindAsync([id], ct);
    return user is null ? Results.NotFound() : Results.Ok(UserDto.From(user));
});

public sealed record UserDto(Guid Id, string Email)
{
    public static UserDto From(User u) => new(u.Id, u.Email);
}

app.Run();
```

## Checklist

- [ ] Nullable reference types enabled at project level.
- [ ] No `.Result`/`.Wait()` in async chains.
- [ ] Records used for DTOs and value objects.
- [ ] EF migrations generated and applied; no pending model diff.

## Common Pitfalls

- `async void` outside event handlers swallows exceptions; use `async Task`.
- Forgetting `CancellationToken` plumbing — long-running requests can't be cancelled.
- Capturing `DbContext` in a singleton; DbContexts must be scoped.
