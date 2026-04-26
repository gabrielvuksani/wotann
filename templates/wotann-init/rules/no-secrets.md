# Rule: No Hardcoded Secrets

NEVER write API keys, tokens, passwords, private keys, OAuth client
secrets, or database credentials directly into source files.

## What this means in practice

- API keys, OAuth tokens, signing keys, and private certificates live
  in environment variables or a secret manager — never in source.
- `.env` files are ignored by git. They are read at runtime; they are
  never committed.
- Test fixtures that need a key use a clearly-fake placeholder
  (e.g. `sk-test-FAKE-FOR-TESTS`) or read from `process.env`.
- Configuration files committed to the repo reference env vars by
  name (`${API_KEY}`), they do not embed the value.

## When you encounter a hardcoded secret

1. STOP. Do not commit. Do not push.
2. Move the value into an environment variable or a secret manager.
3. If the secret was ever pushed to git history, rotate it
   immediately at the provider — git history is public the moment
   it touches a remote.
4. Surface the rotation requirement to the user explicitly. Do not
   "scrub the file and hope" — assume any pushed secret is leaked.

## Examples

WRONG:
```ts
const stripe = new Stripe("sk_live_4eC39HqLyjWDarjtT1zdp7dc");
```

CORRECT:
```ts
const key = process.env["STRIPE_SECRET_KEY"];
if (!key) throw new Error("STRIPE_SECRET_KEY not set");
const stripe = new Stripe(key);
```
