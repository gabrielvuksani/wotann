---
name: django-expert
description: Django 5+, DRF, ORM, admin, migrations, async views
context: fork
paths: ["**/django*", "**/manage.py", "**/settings.py", "**/*/models.py", "**/*/views.py"]
requires:
  bins: ["python3"]
---

# Django Expert

## When to Use
- Building or reviewing a Django app or DRF API.
- Designing models, migrations, or queryset managers.
- Choosing between class-based views, function views, or DRF viewsets.
- Debugging N+1 queries, slow admin, or migration drift.
- Adding async views, Channels, or celery tasks.

## Rules
- Use Django REST Framework for APIs; do not hand-roll JSON responses.
- Put query logic in model managers and custom querysets — keep views thin.
- Every new model change is a migration; never edit migrations post-merge.
- Use `select_related` and `prefetch_related` to avoid N+1 queries.
- Use signals sparingly — they're magic; prefer explicit calls.
- Admin is for staff, not for users — don't expose it externally without protection.

## Patterns
- **Fat models, thin views, smart managers.**
- **Serializer composition** (nested, writable, read-only) for DRF endpoints.
- **Permissions classes** and **throttling** for auth and rate limiting.
- **`prefetch_related` with `Prefetch`** for selective subquery optimization.
- **Async views** for I/O-bound endpoints (`async def` + ASGI server).
- **Celery + Redis** for background tasks, retries, and scheduled jobs.

## Example
```py
# Fat manager keeps views clean and testable.
class ActiveOrderManager(models.Manager):
    def pending(self):
        return self.filter(status="pending").select_related("user")

class Order(models.Model):
    status = models.CharField(max_length=32)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    objects = models.Manager()
    active = ActiveOrderManager()

# View is one line.
class PendingOrders(ListAPIView):
    queryset = Order.active.pending()
    serializer_class = OrderSerializer
```

## Checklist
- [ ] Views are thin; business logic in models / managers / services.
- [ ] `select_related` / `prefetch_related` cover all FK traversals in hot paths.
- [ ] Every migration is atomic (or marked non-atomic intentionally).
- [ ] Admin protected by an internal network or MFA.
- [ ] `DEBUG = False` + `ALLOWED_HOSTS` in production settings.

## Common Pitfalls
- **N+1 queries in templates** — `.prefetch_related` fixes most of it.
- **Editing a shipped migration** — breaks replicas and rollbacks.
- **Signals doing heavy work synchronously** — move to Celery.
- **Using `.objects.all()` for admin lists** on huge tables.
- **Leaking `SECRET_KEY`** into repo settings.
