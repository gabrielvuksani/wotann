---
name: php-pro
description: PHP 8.3+, Laravel, Symfony, strict types, and modern patterns
context: fork
paths: ["**/*.php", "**/composer.json"]
requires:
  bins: ["php", "composer"]
---

# PHP Pro

## When to Use

- Writing a new Laravel 11 or Symfony 7 service with strict types.
- Migrating PHP 7.x code to PHP 8.3+ with readonly classes and typed constants.
- Refactoring legacy procedural code into modern OOP with constructor promotion.
- Running PHPStan level 8 / Psalm level 1 over an existing codebase.
- Integrating queues, events, and typed enums into a Laravel backend.

## Rules

- PHP 8.3+ only; `declare(strict_types=1);` at the top of every file.
- Use constructor property promotion for DTOs and value objects.
- Backed enums for database-persisted values; never raw strings/ints.
- PHPStan level 8 or Psalm level 1 green in CI, no baseline erosion.
- Readonly classes for immutable value objects (`readonly class Money`).
- Never use `@` error suppression; catch and handle explicitly.

## Patterns

- **Laravel Form Requests**: move validation out of controllers into request classes.
- **Eloquent scopes**: reusable query fragments (`scopeActive`, `scopeRecent`).
- **Jobs + Queues**: async side-effects (`Bus::dispatch`), never synchronous email in HTTP path.
- **Events + Listeners**: decouple triggers from reactions (`UserRegistered` -> `SendWelcomeEmail`).
- **Service container**: bind interfaces to implementations for testability.

## Example

```php
<?php
declare(strict_types=1);

namespace App\Domain;

enum InvoiceStatus: string
{
    case Pending = 'pending';
    case Paid = 'paid';
    case Voided = 'voided';
}

final readonly class Invoice
{
    public function __construct(
        public string $id,
        public int $amountCents,
        public InvoiceStatus $status,
    ) {}

    public function withStatus(InvoiceStatus $s): self
    {
        return new self($this->id, $this->amountCents, $s);
    }
}
```

## Checklist

- [ ] `declare(strict_types=1);` on every file.
- [ ] PHPStan level 8 (or Psalm level 1) green, no new baseline entries.
- [ ] DTOs use readonly + constructor promotion.
- [ ] Enums used for any status/type column.

## Common Pitfalls

- Mixing string enum values with integer DB column; migration breaks silently.
- `null` returns without declared `?T` nullable type; PHPStan catches but only at level 8.
- Forgetting to queue a job that sends email; the HTTP request times out waiting for SMTP.
