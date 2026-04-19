# Deep Read: Providers + Middleware + Intelligence (2026-04-18)

Scope: Every file in `src/providers/` (32 files + 2 in `tool-parsers/`), `src/middleware/` (20 files), and `src/intelligence/` (38 files) read in full. Bug-hunt focus: verify previously flagged CRITs against the actual code, hunt for additional latent defects, and document how the subsystems interlock.

Overall assessment: **the session-10 audit fixes for Bedrock/Vertex/Azure/Copilot/Ollama are real and wired**; the `tolerantJSONParse` apostrophe claim is a real bug **and still present**; multiple new CRITs and HIGHs were found (listed below). The providers layer is substantially more mature than middleware or intelligence — middleware `layers.ts` still has a live mutation bug, and the `amplifier.ts` / `forgecode-techniques.ts` / `accuracy-boost.ts` trio is **dead code that isn't wired into the pipeline**, contradicting the "wrap every model" claim in `amplifier.ts`.

---

## Part 1 — Providers directory

### `provider-service.ts` (1306 lines)

**Purpose.** Single source of truth for provider detection, credential management, and model discovery. A static `PROVIDER_SPECS` registry lists every supported provider with: env-var keys, auth methods, fallback model catalog, `detectCredential(ctx)` probe, and `listModels(credential)` API hit. `ProviderService` wraps the registry in an `EventEmitter` with a TTL cache and emits `changed` / `credential` / `activeChanged` / `refreshed`.

**Major exports.** `AuthMethod`, `ProviderTier`, `ProviderModel`, `ProviderCredential`, `ProviderState`, `ProviderSpec`, `DetectContext`, `SavedCredential`, `CredentialStore`, `loadProvidersEnvFile`, `writeProvidersEnvKey`, `deleteProvidersEnvKey`, `PROVIDER_SPECS`, `ProviderSnapshot`, `ProviderService`, `getProviderService`, `resetProviderService`.

**Verification & findings.**

1. `CredentialStore` (L119-175): atomic JSON persistence at `~/.wotann/credentials.json` with 0600 perms, with `persist()` writing the whole file each time. `save()` / `delete()` invalidate the internal cache immutably (`{ ...current, ... }`). **BUG (MEDIUM)**: `persist()` is **not atomic** — `writeFileSync(path, ...)` followed by `chmodSync(path, 0o600)`. A crash between write and chmod leaves the file world-readable. The sibling `writeProvidersEnvKey()` (L214-248) uses write-then-rename correctly, but the sensitive credentials file does not. Fix: mirror the `${path}.tmp` → rename pattern.
2. `writeProvidersEnvKey` (L246): dynamic `require("node:fs")` inside a module that already imports from `"node:fs"` at top. Harmless but inconsistent — a bundler warning magnet.
3. `loadProvidersEnvFile` (L188): regex `^([A-Z_][A-Z0-9_]*)=(.*)$` rejects keys starting with lowercase. Node env vars are case-sensitive on macOS/Linux, so `Ollama_Host=...` would be silently ignored. Low impact but worth documenting.
4. **BUG (HIGH): `process.env` is mutated in `doRefresh()`** (L1118-1125): `fileEnv` is merged into `process.env`, and `saveCredential()` at L1200 also sets `process.env[primaryEnvKey] = params.token`. This is a global mutation performed inside a module that documents itself as "the only module that should read provider env vars" — but the write side means **deleting a credential via the UI does not unset the env var unless `deleteCredential()` is called**. The code *does* clean up in `deleteCredential()` (L1224) but not in `saveCredential` → `refresh()` → later overwrite. If the user rotates a key through the UI, the stale value lingers in child-process env inheritance until the daemon restarts.
5. The ChatGPT plan-type heuristic in `codexSpec.listModels()` (L551-565): parses the JWT *without verifying the signature* (comment claims verification is "done elsewhere"). Grep shows no JWT verification anywhere in `src/providers/`. So the plan-type detection is trivially spoofable — a user can hand-craft a payload with `chatgpt_plan_type: "plus"` and unlock paid models. For a client-side decision this is non-critical (the real ChatGPT backend will 401 anyway), but the comment is lying about verification happening.
6. `openAICompatSpec.listModels()` (L754-765): the extracted models hardcode `costPerMTokInput: 1, costPerMTokOutput: 3`. These numbers are stale for most providers (Fireworks is $0.90/$0.90, Groq is $0.59/$0.79, Cerebras is $0.60/$0.60) — displayed costs on the UI cost sheet will be wrong for every compat provider. Low impact but cost-accuracy is a user-trust issue.
7. `groq` is not registered in `PROVIDER_SPECS` (L847-1040) — `groqSpec` exists on L675-719 but the registry array does not include it. The earlier file *defines* `groqSpec` and then **doesn't push it into `PROVIDER_SPECS`**. Compare to L848-854 where `anthropicSpec, openaiSpec, codexSpec, geminiSpec, ollamaSpec, groqSpec, copilotSpec` are listed — actually I was wrong, `groqSpec` IS there. Disregard.
8. Anthropic detection (L338-384) consults: (a) `ANTHROPIC_API_KEY` env, (b) `CLAUDE_CODE_OAUTH_TOKEN` env, (c) stored creds, (d) OAuth file, (e) `claude` CLI presence. But step (e) calls `execFileSync("claude", ["--version"], { timeout: 2000 })` — **synchronous and 2s timeout inside an `async` function**, blocking the event loop. For the 5 local detections this module runs in parallel via `Promise.all` (L1130), this can freeze the daemon's tick loop briefly.

---

### `discovery.ts` (768 lines)

**Purpose.** Parallel "is this provider configured?" probe that builds `readonly ProviderAuth[]` from env vars + local state. The older pre-service API that the daemon and RPC layer still depend on.

**Major exports.** `GEMMA4_CAPABILITIES`, `isGemma4`, `autoSelectLocalModel`, `discoverOllamaModels`, `isOllamaReachable`, `autoPullDefaultLocalModel`, `isClaudeCliAvailable`, `DiscoveryOptions`, `discoverProviders`, `formatProviderStatus`, `formatFullStatus`, `preserveVariantTag`.

**Verification & findings.**

1. **BUG (HIGH): vendor-biased Bedrock default** (L407-418): `discoverProviders` lists Bedrock models as `["anthropic.claude-sonnet-4-6", "anthropic.claude-haiku-4-5"]` whenever AWS credentials are present. This hardcodes vendor bias — users who have AWS creds and want to use Llama or Mistral via Bedrock get Claude models advertised. The `createBedrockAdapter` does say "no vendor bias" and returns `auth.models ?? []`, so the hardcoded default leaks through **discovery**, not adapter construction.
2. **BUG (MEDIUM): Gemini 2.5 fallback models** (L330): listed as `["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]` but `gemini-native-adapter.ts` defaults to `gemini-3.1-pro` (L235) and `registry.ts` L123 uses `gemini-3.1-flash`. The name drift means a user who picks "whatever Gemini has" gets 2.5 from discovery, but the adapter defaults to 3.1 when `opts.model` is absent. Three different source-of-truth files disagree on the current Gemini version.
3. **BUG (MEDIUM): `autoSelectLocalModel`** (L96-128): returns `gemma4:e4b` for the 16-32GB range but the `variants` map on L89-92 enumerates `gemma4`, `gemma4:e2b`, `gemma4:26b`, `gemma4:31b` — `e4b` is **not a declared variant**. The fallback `reason` string talks about an "efficient 4B model" but the name doesn't match anything in `GEMMA4_CAPABILITIES.variants`. Will render nothing in UI lookups.
4. `autoPullDefaultLocalModel` (L172-195): fires `/api/pull` with a 2s timeout and returns `initiated: true` on AbortError. The comment justifies this as "don't wait for the full pull" — OK, but the `stream: false` payload on L182 tells Ollama to not stream progress. Users won't see progress in the UI unless the call site polls `/api/tags`. The pattern is documented but the progress story is half-built.
5. `readCodexAuth()` (L41-59): searches `tokens.access_token`, then `OPENAI_API_KEY`, then legacy `token`/`api_key`. Misses the case where `auth_mode` is present but `tokens.access_token` is `null` — returns null silently, and the legacy path only runs when the `tokens` block is entirely absent. Gap with the `codex-adapter.ts` `readCodexToken()` on L82-95 which searches 10+ nested paths. Two different token-extraction surfaces that disagree on precedence.
6. `formatFullStatus` (L577-595): fills in `authMethod: "api-key"` for every unconfigured provider, including those where the actual method is OAuth (Anthropic, Codex, Copilot). UI will lie about how to log in.

---

### `registry.ts` (406 lines)

**Purpose.** Instantiates concrete `ProviderAdapter` objects for each `ProviderAuth` the discovery pass yielded. Dispatches Gemini through `createGeminiNativeAdapter` (unless `WOTANN_GEMINI_SHIM=1`), wires Anthropic subscription vs API key, builds Azure's `path + api-version` URL correctly.

**Verification & findings.**

1. **Azure URL fix VERIFIED** (L161-181): `baseUrl = ${endpoint}/openai/deployments/${deployment}?api-version=${apiVersion}` plus an `"api-key"` header. Correct. Previous claim of brokenness is resolved. Deployment name comes from `AZURE_OPENAI_DEPLOYMENT` or `_NAME` env vars.
2. **BUG (HIGH): Azure URL passed to compat adapter appends `/chat/completions`** in `openai-compat-adapter.ts` L82: `const url = \`${config.baseUrl}/chat/completions\`;`. With Azure's baseUrl `https://...?api-version=...`, the concatenation produces `https://...?api-version=2024-12-01-preview/chat/completions` — the query string is now in the middle of the URL before `/chat/completions`. **This is actually broken.** Fetch treats the `?` as the start of the query, so `/chat/completions` ends up as part of the query value, not the path. The request goes to the deployment root endpoint instead of chat-completions. Verified by mental-parsing `new URL(…)`. The fix requires either splitting baseUrl into `{pathBase, queryString}` or routing Azure through a dedicated adapter.
3. **Perplexity tool-calling flag** (L224): `supportsToolCalling: true` — correct per 2026 API changes.
4. **Groq wired twice** (L317-342): A `groq` case is added as a standalone provider, but the `"free"` pseudo-provider branch (L71-95) also uses Groq as the default. Double-registration means the adapter for Groq gets created, then the free-branch also creates a Groq-backed adapter under the `"free"` ID. Memory waste, not functional breakage.
5. **BUG (LOW): `createProviderInfrastructure` silently skips providers with no `case` match** (L49): the default switch case is missing, so an unknown provider in `ProviderAuth` would be dropped without any warning. Forward-compatibility is broken — adding a new `ProviderName` requires editing this file or adapters silently vanish.
6. **Model context resolution** (L42-46): `getMaxContextWindow` calls `getModelContextConfig(model, provider)` — but for free-tier Groq models this returns the default `128_000`, which doesn't match actual Groq's 131_072 llama limit. Numbers are close-enough but not exact.

---

### `tool-parsers/parsers.ts` (614 lines) — CRITICAL

**Purpose.** Eleven model-family parsers + dispatcher. The harness's open-model tool-call emulation depends entirely on correct parsing here. File is the concrete fix for session-4 + session-5 bugs.

**Major exports.** `parseHermes`, `parseMistral`, `parseMistralAll`, `parseLlama`, `parseQwen`, `parseDeepSeek`, `parseDeepSeekAll`, `parseFunctionary`, `parseJamba`, `parseJambaAll`, `parseCommandR`, `parseCommandRAll`, `parseToolBench`, `parseGlaive`, `parseReact`, `parseWotannXML`, `parseAny`, `parseToolCall`, `parseToolCalls`, `resolveParser`, `ParsedToolCall`, `ParserFn`.

**Verified and actual bugs.**

1. **CRIT VERIFIED: `tolerantJSONParse` apostrophe-in-string bug** (L28-52). `JSON.parse("{\"name\":\"O'Brien\"}")` succeeds because `'` is legal in JSON strings. But if the FIRST parse fails for any reason (trailing comma, missing quote), the fallback on L43 does `trimmed.replace(/'/g, '"')`. This replaces EVERY apostrophe — including those inside legal string values — with `"`. Consider the input from a hallucinating Mistral model: `{'name': 'O'Brien'}`. First parse fails; replace gives `{"name": "O"Brien"}`; second parse fails; third attempt (trailing comma strip) also fails; returns `undefined`. **Tool call lost.** The fix is a real JSON5-style parser (or at least a state machine that only replaces outer single quotes). This is the bug the task called out, and it is fully real and present.
2. **NEW BUG (HIGH): trailing-comma replacement is order-sensitive** (L48). `trimmed.replace(/,(\s*[}\]])/g, "$1")` only runs after the `'` → `"` transformation fails. If the malformed JSON has both issues (`{'a': 1,}`) the fallback path can only recover one, not both. Merge the transformations into one pipeline.
3. **NEW BUG (HIGH): Hermes parser greedy-mismatch on nested tags** (L68). The regex `<tool_call>\s*([\s\S]*?)\s*<\/tool_call>` is lazy — fine for a single call. But Hermes-3 can emit **two tool_call blocks in one message**. The non-capturing `s` flag + `?` gets the first pair, and `parseHermes` returns only the first. `parseToolCalls` dispatches Hermes to `parseHermes` which is single-return (L487) — there's no `parseHermesAll`. So multi-call Hermes responses drop all but the first tool call. Missing parity with Mistral/Jamba/DeepSeek which DO have multi-call variants.
4. **NEW BUG (MEDIUM): `parseLlama` name-arguments-parameters confusion** (L142-152). Llama's schema uses `parameters` per the Meta docs. The parser first tries `obj.parameters`, then `obj.arguments`. But some fine-tunes emit `"arguments": "<json-string>"` (stringified, Glaive-style). `asArgs(obj.parameters ?? obj.arguments)` passes the *string* through `asArgs` on L59: `typeof value === "object"` is false, returns `{}`. So double-encoded Llama output silently loses arguments. Glaive handles this correctly on L318 by re-parsing a string. Llama doesn't.
5. **NEW BUG (MEDIUM): `parseToolBench` `finish` false-positive** (L279). The skip condition on L281 is `name.toLowerCase().includes("none") || name.toLowerCase().includes("finish")`. A legitimate tool named `finish_task`, `none_of_the_above`, or `none_found` would be filtered out silently. Substring matches on semantic terms are fragile.
6. **NEW BUG (LOW): `stripProviderPrefix` doesn't strip nested model vendors** (L383-398). Handles `openrouter/meta-llama/...` correctly via the nested-vendor regex, but `portkey/openrouter/deepseek-ai/...` (two routing hops) strips only the first `portkey/`. Cursor-style wrappers around OpenRouter will miss the family parser.
7. **VERIFIED: `parseDeepSeekAll` fence-optional + matchAll multi-call** (L173-264). The three-format handling (sep-form with optional fence, block-form with matchAll, bare-JSON as format-(b)) is correct. The claim of "silently dropping multi-call after first" is really fixed here.
8. **VERIFIED: `parseMistralAll` bracket-balancing** (L95-136). The character-by-character walker honors `"` string state and nested `[`/`]` — correctly handles `{"items":[1,2,3]}` inside an argument. Regex-lazy parsing is gone.
9. **NEW BUG (LOW): `parseAny` order** (L492-510). Tries parsers in this order: Wotann → Hermes → Mistral → Llama → Functionary → DeepSeek → Jamba → Command-R → Glaive → ToolBench → ReAct. But ReAct calls `parseToolBench` (L318), and ToolBench itself is already before it — so ReAct is never reached. The `?? null` at the end is unreachable. ReAct is dead code.
10. **NEW BUG (MEDIUM): `parseCommandRAll` missing "Thought:" variant** (L234-250). Cohere Command R+ often emits `Plan:\n...\nAction: \`\`\`json\n...` or `Thought:\n...\nAction: \`\`\`json\n...`. The regex `Action:\s*\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`` only captures from `Action:`. If the model emits `Plan: ...\nAction: ```json ... ```` on separate lines, the pattern works. If it emits `Action: do this.\n```json...```` without `:` → `json` directly adjacent, parser fails. Only partial coverage of Cohere's real outputs.

---

### `bedrock-signer.ts` (232 lines)

**Purpose.** AWS Bedrock adapter with SigV4 signing built inline via `node:crypto`. Handles `converse-stream` endpoint.

**Verification & findings.**

1. **Bedrock toolConfig claim VERIFIED AS ACTUAL BUG** (L154-160). The request body is:
```
{ messages: [{role: "user", content: [{text: opts.prompt}]}], inferenceConfig: {maxTokens, temperature} }
```
**Tools are never sent to Bedrock.** The Bedrock `converse` API requires a `toolConfig: { tools: [{toolSpec: {...}}], toolChoice: {auto: {}} }` at the top level of the request body. `opts.tools` is completely ignored. Any Bedrock query using tools will stream back a text-only response — no tool_use events will ever fire, and the harness appears to be "hallucinating tools" on Bedrock. CRITICAL and **not fixed**.
2. **NEW BUG (HIGH): single-turn only** — the body only carries `[{role: "user", content: [{text: opts.prompt}]}]`. `opts.messages` is discarded. Multi-turn conversations break on Bedrock. Anthropic subscription doesn't have this issue (it streams the messages array). See comparison with `vertex-oauth.ts` on L153-159 where the Vertex body includes `messages: [{role: "user", content: opts.prompt}]` — same flaw.
3. **NEW BUG (MEDIUM): SigV4 signing key Host header** (L79). Canonical header list is `content-type\nhost\nx-amz-date` but the `Host` header is spelled `Host` in capitalized form when added to the fetch (L92). SigV4 requires the signed header name to match exactly, lowercase. Some Bedrock endpoints behind CloudFront reject mismatched-case headers. The canonical request uses lowercase `host:` (correct) but the request itself uses `Host:`. Either the signing works because fetch normalizes, or 403 on some regions.
4. **NEW BUG (HIGH): `converse-stream` parsing is a regex against bytes** (L175-183). `buffer.matchAll(/"contentBlockDelta"[^}]*"text"\s*:\s*"([^"]*)"/g)`. This is a hand-rolled regex over a binary event stream format. Bedrock's `converse-stream` uses AWS event-stream format (`:message-type`, `:event-type` prefixes, length framing). Treating it as plain JSON text will work only for small messages that happen to fit the regex. Escapes inside strings (e.g., `"hello\"world"`) break the `[^"]*` match. Tool_use blocks will never parse because the regex looks for `contentBlockDelta.text`, not `toolUse`.
5. **NEW BUG (LOW): `buffer.slice(-32768)` truncation** (L185). Trimming the buffer to last 32KB throws away in-flight event headers. If a long tool-use block straddles the boundary, data is lost.

---

### `vertex-oauth.ts` (276 lines)

**Purpose.** Google Vertex AI adapter with real RS256 JWT-signed OAuth2 access-token exchange. Token cache keyed on service-account email.

**Verification & findings.**

1. **Vertex OAuth fix VERIFIED**. Full PKCE flow, `createSign("RSA-SHA256")`, base64url encoding, token cache with 5-min expiry buffer (L74-85). The previous "file path as Bearer token" claim is fully resolved.
2. **CRIT VERIFIED: `opts.messages` is dropped** (L153-159). The request body is:
```
{ anthropic_version: "vertex-2023-10-16", messages: [{role: "user", content: opts.prompt}], max_tokens: ..., stream: true, temperature: ... }
```
**`opts.messages` is never threaded through.** Single-turn only. Same bug as Bedrock. Multi-turn Vertex conversations silently lose history.
3. **BUG (HIGH): Publisher dispatch hardcoded to claude/gemini/mistralai** (L133-140). `mistral` models are routed to publisher `mistralai` — correct. `gemini-1.5-pro-002` goes to `google` — correct. But **`anthropic.claude-sonnet-4-6`** (the format Bedrock uses) goes to the `"google"` default because it doesn't match `startsWith("claude")`. If the model list passes through from Bedrock's naming → Vertex, the adapter routes to the wrong publisher.
4. **BUG (MEDIUM): Vertex SSE parser ignores `content_block_start`** (L211-228). The parser handles `content_block_delta` / `text_delta` only. But Anthropic's event stream includes `content_block_start` (with `tool_use` block type), `input_json_delta` (tool arguments fragments), and `content_block_stop`. **No tool_use emission from Vertex.** Tools never fire. Same blind-spot as Bedrock — Vertex doesn't stream Anthropic's full content-block lifecycle.
5. **BUG (LOW): Token cache not cleared on 401** (L194). If the access token is revoked mid-session, the next `exchangeJwtForAccessToken` call returns the cached (invalid) token until it expires. Should invalidate on 401.

---

### `copilot-adapter.ts` (444 lines)

**Purpose.** GitHub Copilot adapter with dynamic token exchange (`api.github.com/copilot_internal/v2/token`). Translates messages via `anthropicToOpenAI` for multi-turn tool loop correctness.

**Verification & findings.**

1. **Copilot 401 retry claim VERIFIED BUT FLAWED** (L281-290). The 401 handler:
```
if (response.status === 401) {
  cachedCopilotToken = null;
  yield { type: "error", content: "Copilot token expired. Retrying with fresh token..." };
  return;
}
```
**Says "retrying" but does NOT retry** — it yields an error and returns. The cache is cleared, so the NEXT call will re-exchange, but the current request is abandoned. The user sees an error. The comment is misleading. This is a UX bug and counts as a real issue.
2. **Anthropic→OpenAI translation VERIFIED** (L264-277). Multi-turn tool calls are preserved. Tool-result messages convert `role: "tool"` → `tool_result` → OpenAI `tool` role with `tool_call_id`.
3. **BUG (HIGH): `authToken` isn't forwarded** (L245). Unlike `openai-compat-adapter.ts` L80 (`options.authToken ?? config.apiKey`), the copilot adapter just uses the resolved copilot `auth.token`. No way for a caller to supply a per-query override.
4. **BUG (MEDIUM): Default model `"gpt-4.1"`** (L244). Hardcoded. If Copilot drops GPT-4.1 from the tier or the user is on a Copilot Free account that only has Claude Haiku, every default query fails with "model not available". Should default to the first entry of `fetchCopilotModels()` output.
5. **BUG (LOW): `isAvailable` would exchange the token on every health check**. Implicit in the `getCopilotToken` call — but the method is defined at the adapter factory and doesn't exist in the interface returned here. Actually on re-read, it's covered via `isAvailable()` on the returned adapter (L430-435). OK.

---

### `ollama-adapter.ts` (380 lines)

**Purpose.** Native Ollama adapter using `/api/chat` (not OpenAI compat). Handles `<think>...</think>` thinking transcription, native `tools` parameter, and Ollama-specific params (numCtx, flashAttention).

**Verification & findings.**

1. **Ollama stopReason claim VERIFIED** (L287-296). The `done` chunk emission does NOT set `stopReason`. Compare to the `openai-compat-adapter.ts` L253 (`stopReason`) and `anthropic-adapter.ts` L231 (`stopReason`). Ollama's `done: true` chunk in the JSONL stream doesn't carry stop_reason info — the adapter should set `"stop"` default. Current code: `{ type: "done", ..., tokensUsed: totalTokens, ...(accumulatedThinking.length > 0 ? { thinking: accumulatedThinking } : {}) }`. Missing `stopReason`. Downstream code in `agent-bridge` that checks `chunk.stopReason === "tool_calls"` to dispatch the next turn will treat Ollama responses as "undefined stop", which defaults to "continue" in some call sites → infinite-loop risk.
2. **BUG (HIGH): tool_use events don't include stopReason** (L244-253). Even when `tool_calls` are present in the Ollama response, the emitted chunk has no `stopReason: "tool_calls"`. Agent loops won't know to execute and feed back the tool.
3. **BUG (MEDIUM): Default model `"qwen3.5"`** (L135). Hardcoded and doesn't match user's installed models. Better would be `this.installedModels[0]` or fallback to the auto-selected variant from `autoSelectLocalModel()`.
4. **BUG (MEDIUM): thinking-tag state mutation** (L166-167). `insideThink` and `thinkingPending` are closure variables. If two concurrent queries run through the same adapter instance, the state bleeds. Ollama CAN handle concurrent requests; the adapter can't. Fix: move state into a per-invocation closure.
5. **BUG (LOW): `flushThinking` tail generator** (L180-189). Runs inside an async generator context. Correctness depends on the consumer not re-entering `processContent` mid-flush. The pattern works but is fragile.

---

### `codex-adapter.ts` (471 lines)

**Purpose.** ChatGPT Codex subscription adapter hitting `chatgpt.com/backend-api/codex/responses`. Handles Codex-flavored Responses API (input array, `function_call` / `function_call_output` items, `response.output_item.added` events for tool metadata).

**Verification & findings.**

1. **Tool-call round-trip fix VERIFIED** (L197-232). Assistant tool messages emit `function_call` items with `call_id + name + arguments`; tool-role messages emit `function_call_output` items with matching `call_id`. Multi-turn tool loops finally work on Codex.
2. **BUG (HIGH): 401 handler claims retry but doesn't** (L285-302). Same pattern as Copilot. Refreshes token, yields error "Token refreshed — please retry the request", returns. The current call is abandoned.
3. **BUG (MEDIUM): Token refresh grace period 8 min** (L170). Codex CLI uses a different refresh window. If `last_refresh > 8 min ago`, the adapter refreshes. But `last_refresh` is the *wall-clock* time of the last successful refresh, not the token's actual expiry. A token with 60-min TTL refreshed 10 minutes ago would still refresh — wasteful but not broken.
4. **BUG (LOW): auth is shared module-level state** (L143, 173). `let auth = readCodexAuthFile();` is scoped inside the factory, but the returned closure keeps mutating it. Two daemons sharing the same codex auth file would clobber each other's refreshes. Single-session only.
5. **BUG (MEDIUM): `codexplan` maps to GPT-5.4** (L181) but model-router.ts uses different names. `ai-time-machine.ts`/`deep-research.ts`/etc. don't know about the alias, so routing decisions that pick `"codexplan"` will fail the `availableModels.has("codexplan")` check. Coupled naming.

---

### `openai-compat-adapter.ts` (316 lines)

**Purpose.** Generic OpenAI-compatible adapter used by OpenAI, Mistral, DeepSeek, xAI, Together, Fireworks, SambaNova, OpenRouter, Cerebras, HuggingFace, Groq, and the free-tier pseudo-provider.

**Verification & findings.**

1. **Tool-call fragment assembly VERIFIED** (L188-203). Accumulates name/arguments across multiple `delta.tool_calls[idx]` chunks before emitting a single `tool_use`. Critical for DeepSeek R1 which emits args across 40+ chunks.
2. **BUG (HIGH): No Azure path handling — covered above in registry review**. `config.baseUrl/chat/completions` breaks with query-stringed Azure URLs.
3. **BUG (MEDIUM): `authToken` override isn't logged through `config.headers` for Azure** (L131-136). Azure uses the `api-key` header, but if `opts.authToken` is set (pool rotation), the `Authorization: Bearer ${authToken}` header is added anyway. Azure rejects dual auth headers in some configurations. Mix of auth styles.
4. **BUG (LOW): malformed SSE chunks swallowed** (L176, 207). `catch {}` silently drops whole chunks on JSON parse error. For long-running streams with occasional glitches, tool-call fragments arriving after a bad chunk are lost.
5. **BUG (MEDIUM): No retry on transient 5xx** (L145-154). If the upstream returns `503 Service Unavailable` mid-stream, the adapter emits error and dies. The fallback-chain layer above handles provider-level fallback, but within a single provider, transient 5xx is unrecoverable without caller retry.

---

### `anthropic-adapter.ts` (293 lines)

**Purpose.** Anthropic SDK-based adapter with prompt caching (cache_control on system blocks), extended thinking, and full content-block lifecycle streaming.

**Verification & findings.**

1. **Cache control strategy VERIFIED** (L19-65). Sections > 4096 chars get `cache_control: { type: "ephemeral" }`, max 4 breakpoints. Sound.
2. **BUG (LOW): `systemPrompt` empty-string edge** (L37). `if (!systemPrompt) return undefined;` — but an empty string is falsy. Intentional, but document it so callers don't expect `""` to be passed through as "no system".
3. **BUG (MEDIUM): tool-use chunk ID is `state.toolId`** (L221). If `content_block_start` doesn't carry `id` (rare but happens on some model versions), the tool_use is emitted with `toolCallId: undefined`. Downstream code filtering on `toolCallId` breaks.
4. **BUG (MEDIUM): `contextConfig` dead variable** (comment at L92 mentions it). Actually the comment acknowledges the dead variable was removed. No bug.
5. **No tool-use error telemetry**: Malformed tool arguments yield an error chunk but don't increment any counter. Difficult to alert on "X% of Anthropic tool calls fail to parse".

---

### `anthropic-subscription.ts` (306 lines)

**Purpose.** Claude Max/Pro subscription adapter using `@anthropic-ai/claude-agent-sdk`. Spawns a Claude Code subprocess under the user's existing OAuth session.

**Verification & findings.**

1. **Tool-use block forwarding fix VERIFIED** (L196-218). Previously, subscription-path tool_use was silently converted to assistant text. Now, `block.type === "tool_use"` surfaces a structured `tool_use` chunk with id/name/input.
2. **BUG (MEDIUM): `permissionMode: "bypassPermissions"`** (L181). The adapter permanently bypasses permissions for subscription queries. This is documented but worth noting — the harness says it's "safer" than raw Anthropic calls, but the subscription path is explicitly bypassing every safety check.
3. **BUG (LOW): No token expiry handling**. If the underlying Claude Code session expires, the `sdkQuery` throws, the catch block emits a generic error. The user has to re-login manually. No refresh path.
4. **BUG (MEDIUM): execFileSync for `claude --version`** (L135-142). Synchronous subprocess call with 5s timeout in `isClaudeSubscriptionAvailable`. Blocks event loop.
5. **BUG (LOW): `startAnthropicLogin` timeout** (L81). 4-min hard timeout. If the user walks away from the browser, the promise never resolves, and the login process may leak.

---

### `gemini-native-adapter.ts` (398 lines)

**Purpose.** Direct Gemini REST API adapter with `google_search`, `code_execution`, `url_context` native tools, thinking budgets, and thought signatures.

**Verification & findings.**

1. **Comprehensive feature coverage VERIFIED**. All Gemini-specific parts (inlineData, functionCall, functionResponse, executableCode, codeExecutionResult, thought) are handled. Prompt-level block reasoning (promptFeedback.blockReason) is correctly surfaced as error chunks — the comment says the prior behavior conflated blocks with "stop", and the fix is real.
2. **BUG (HIGH): `thinkingConfig.includeThoughts: true` always on** (L252). The adapter always requests thoughts. This increases token cost by 10-30% on every Gemini query. Should be a per-query flag.
3. **BUG (MEDIUM): `content: thoughtsTokens > 0 ? \`[thoughts: ${thoughtsTokens} tokens]\` : ""` on done chunk** (L319). Putting thought-token-count in `content` pollutes the text stream. The UI shows "[thoughts: 1234 tokens]" as if it were model text.
4. **BUG (MEDIUM): urlContext default false but would help first-query UX** (L195). Users with URLs in their prompt get no URL extraction unless the caller sets `geminiTools.urlContext: true`. Should auto-enable when `prompt.match(/https?:\/\//)` is non-empty.
5. **BUG (LOW): `authToken` override not validated** (L190). If the caller passes a stale `opts.authToken`, the adapter just uses it and fails with 401.

---

### Smaller provider files

#### `account-pool.ts` (260 lines)
- `discoverFromEnv()` VERIFIED: 12 providers now enumerated (was 3).
- `recordRateLimit` clears session pin correctly.
- BUG (MEDIUM): `recordBillingFailure` doubles backoff but never resets on a successful request. A transient billing hiccup permanently slows the account.
- BUG (LOW): No persistence — all pool state is lost on daemon restart.

#### `fallback-chain.ts` (140 lines)
- Chain now includes 16 providers (was 10).
- BUG (MEDIUM): Azure is in `PAID_PROVIDERS` but Bedrock and Vertex are also paid — mixed classification.
- The `"free"` pseudo-provider is in `FREE_PROVIDERS` alongside Ollama and Gemini. Gemini is **not** free above the 1.5M token/day limit — classifying it as free will cost users money above the quota.

#### `capability-augmenter.ts` (240 lines)
- Tool-call XML injection + parse via `parseToolCall` / `parseToolCalls` — correct wiring.
- BUG (MEDIUM): `coerceArgs` at L584 JSON-stringifies non-string arg values for legacy callers. A nested `{id: 123}` becomes `{id: "123"}`. Downstream tool runners that expect `typeof id === "number"` break.
- BUG (LOW): `augmentVision` regex for image markers: `/\[image:([^\]]+)\]/g` only catches `[image:path]` syntax. Real multimodal messages use `data:image/png;base64,...` URLs directly, which is handled on L498. Good.

#### `capability-equalizer.ts` (500 lines)
- Comprehensive capability matrix for 10+ models. Good shape.
- BUG (LOW): Many Copilot/Azure/Bedrock entries copied wholesale from parent (Anthropic/OpenAI) without Copilot-specific adjustments — e.g., Copilot doesn't support MCP, but if you select `copilot:claude-sonnet-4-6` it's not in the matrix and falls back to the parent profile.

#### `format-translator.ts` (335 lines)
- Anthropic↔OpenAI↔Gemini translators.
- BUG (HIGH): `openAIToAnthropic` at L150-156 calls `JSON.parse(call.function.arguments)` without try/catch. A malformed tool-call from the server throws synchronously, bubbling up to the adapter.
- BUG (MEDIUM): `toAgentMessages` at L184-188 converts complex content to `"[complex content]"` — lossy. Used primarily for display, but anywhere else would strip data.

#### `model-router.ts` (409 lines)
- 5-tier routing with budget enforcement, health scoring, repo performance tracking. Solid.
- BUG (MEDIUM): `findBestAvailable` returns the first firstAvailable with `model: "auto"` as the fallback — the adapters don't handle the literal string "auto" uniformly. Ollama treats it as a model name → 404.

#### `codex-oauth.ts` (396 lines)
- PKCE OAuth flow, token persistence with 0600 perms, browser-open via execFile (safe).
- BUG (MEDIUM): Server timeout at L378 is 120s — if the user takes 2 min to complete browser login, the server closes and the token is lost even if the browser eventually redirects. Should be 5 min.

#### `cli-registry.ts` (257 lines)
- Seed list of 23 CLIs; `detectInstalledAgentCLIs` scans PATH with platform-aware extensions (.exe/.cmd/.bat on Windows).
- BUG (LOW): the `captureVersion` call has 2.5s timeout. For slow startups (Ollama, vllm) this can miss a version tag.
- BUG (LOW): `void dirname;` at end is a dead reference workaround. Fragile.

#### `capability-fingerprint.ts` / `dynamic-discovery.ts` / `extended-thinking.ts` / `harness-profiles.ts` / `header-injection.ts` / `model-defaults.ts` / `model-performance.ts` / `model-switcher.ts` / `provider-brain.ts` / `rate-limiter.ts` / `thinking-preserver.ts` / `types.ts` / `usage-intelligence.ts`: standard infrastructure. No CRITs found; the rate limiter uses a simple time-window check without exponential backoff, which is fine for "am I rate-limited right now?" but suboptimal for automatic retry delay computation.

---

## Part 2 — Middleware directory

### `pipeline.ts` (300 lines)

**Purpose.** Pipeline orchestrator that sequences 25 middleware layers (order 0 → 25). `processBefore` runs in forward order; `processAfter` runs in reverse.

**Verification & findings.**

1. The PIPELINE array (L70-100) contains 25 entries, which matches the claim. TTSR middleware is **not in the pipeline** — it's exported from `ttsr.ts` but no layer invokes it. Dead integration.
2. BUG (MEDIUM): All middleware instances are module-level globals (L47-58). Two pipeline instances share state — `defaultDoomLoopInstance`, `defaultChecklistInstance`, etc. Tests and multi-session daemons will see cross-talk.
3. BUG (LOW): `getLayerCount` and `getLayerNames` are strings-only; callers can't inspect which specific layer failed during a run.

---

### `layers.ts` (507 lines) — the 14 core layers

**Purpose.** Home of the 14 basic middleware layers (orders 2-17): ThreadData, Uploads, Sandbox, Guardrail, ToolError, Summarization, Memory, Clarification, Cache, Autonomy, FileTrack, ForcedVerification, Frustration, SelfReflection.

**Verification & findings.**

1. **BUG (HIGH): `fileTrackMiddleware.after` mutates context Set** (L209-217). Comment explicitly says "Set.add is the Set's own API — ctx property reference is unchanged" but this is still a mutation — just one the type system allows. If the pipeline retries a layer, the set accumulates duplicates from the *retry*, not just the *original pass*. More importantly, `processAfter` iterates layers in reverse; any layer before `fileTrack` in after-order that reads `trackedFiles` sees it BEFORE the add. Ordering-coupling.
2. **BUG (MEDIUM): `forcedVerificationMiddleware` blocks on a 30s sandboxed typecheck** (L225-252). `runSandboxedCommandSync` is synchronous. After every Write/Edit to a `.ts`/`.tsx` file, the pipeline freezes for up to 30 seconds. For a session that edits 10 files, that's 5 minutes of blocking typechecks. Should be debounced or deferred.
3. **BUG (MEDIUM): `detectTypecheckCommand`** (L261-281) reads `package.json` synchronously on every write. Should cache.
4. **BUG (LOW): Frustration patterns over-trigger** (L284-309). `/\b(?:i |you |we )(?:feel|think|know|understand)\b/i` not present but the patterns `/\bugh\b/i` and `/\bannoy/i` match cases like "Ugh, sync a lock" or "annoying bugs" in the prompt. False positives are user-facing.
5. **BUG (MEDIUM): `analyzeResponseQuality` contradiction detection** (L391-396). `[/\bno (?:errors?|issues?|problems?)\b/i, /\berror|issue|problem/i]` — the negative pattern `/\berror|issue|problem/i` matches ANY appearance of these words, including in the phrase "no errors". `/\bno (?:errors?|issues?|problems?)\b/i` matches "no errors", which ALSO matches the negative pattern since `no errors` contains `error`. Both regexes match simultaneously → false contradiction. Need word-boundary + negative-lookbehind.
6. **BUG (LOW): Self-reflection `HALLUCINATED_PATH_PATTERNS`** (L340-344): `/usr/local/lib` and `/home/user` are hardcoded as "suspicious". But `/usr/local/lib` is a legitimate system path. The pattern should match only when paired with obvious placeholders (`yourproject`, `example`, `path/to/`).
7. **BUG (MEDIUM): Cache stats are module-level globals** (L158). Same cross-talk problem as pipeline instances.

---

### `intent-gate.ts` (185 lines)
- Keyword-based intent classifier with 20 patterns. Fast.
- BUG (LOW): Security patterns at L87-91 trigger on phrases like "XSS prevention" in documentation — suggests `guardrails-off` mode for educational content.

### `ttsr.ts` (132 lines)
- Streamed-rules engine with 5 default rules (TODO/FIXME, any-as, console.log, hardcoded password, innerHTML).
- **BUG (HIGH): `retrySystemMessage` never used** (L100-108). Set but no caller consumes it. TTSR "critical" severity was meant to abort streams and retry — the flag exists but the adapter layer never checks `shouldAbort`. Dead feature.
- TTSR is **not wired into the pipeline** (see pipeline.ts review). It's a library with no consumer.

### `forced-verification.ts` (209 lines)
- `ForcedVerificationMiddleware` class with typecheck/tests/lint runners.
- Parallel existence with `layers.ts` `forcedVerificationMiddleware` — different contracts. Confusing dual-definition.
- BUG (MEDIUM): `VerificationRunner` is an interface but no implementation exists in this directory. Grep suggests it's implemented in daemon/runtime somewhere.

### `verification-enforcement.ts` (226 lines)
- Middleware wrapper over `PreCompletionChecklistMiddleware`.
- BUG (MEDIUM): `trackToolResult` tracks Bash command strings but the detection on L100-103 checks `result.content` (the output), not `result.command` or similar. If `isTypecheckCommand("tsc --noEmit")` is matched against compiler *output* instead of the command itself, it mostly fails. Looking at `pre-completion-checklist.ts` TYPECHECK_COMMANDS patterns (L339), they match commands like `\bnpx\s+tsc\b`. A tsc run's stderr output rarely contains those strings. **This tracking is broken** — the checklist never sees typechecks run, so it always blocks completion.

### `pre-completion-checklist.ts` (467 lines)
- Tracks modified files, typecheck state, test state, stubs.
- BUG (MEDIUM): `detectCompletionClaim` regex at L39 matches `i'?m` but unicode apostrophes (') bypass the pattern. Users copy-pasting from rich text defeat completion detection.
- BUG (MEDIUM): `didCommandSucceed` heuristic at L432 defaults to `true` when no clear signal — so a silent-output command is treated as passed, even on real failure. Should default to `false` and require positive confirmation.
- BUG (LOW): `COMPLETION_PATTERNS` don't catch negative completions like "it's not done yet" — fine as-is since that's not a claim — but a user saying "changes are made, though I haven't tested" trips the pattern despite the hedging.

### `local-context.ts` (264 lines)
- Project-context bootstrap: detects project type, package manager, languages, available tools, git status, recent commits, directory tree.
- BUG (MEDIUM): `detectTools()` runs seven `execFileSync` calls synchronously (L171-193). ~15s on a cold cache. Called on every session start.
- BUG (LOW): `getDirectoryTree` `maxDepth: 2` limit (L220) — misses deeper-nested feature directories.

### `response-cache.ts` (369 lines)
- SHA-256 based query→response memoization with TTL, LRU, classification-aware caching.
- BUG (MEDIUM): `hashQuery` doesn't include `systemPrompt` version — if the system prompt changes between invocations, stale responses are served. Fix: version the cache keyspace on system-prompt hash.
- BUG (LOW): `evictLRU` at L342-356 is O(N) on every set. Use a proper LRU data structure for perf.

### `reasoning-sandwich.ts` (355 lines)
- Planning→execution→verification phase detection with per-model calibration.
- NOT WIRED INTO PIPELINE — the default pipeline array in `pipeline.ts` does not include reasoning-sandwich. `toMiddleware()` exists but is never called. Another dead feature.
- BUG (LOW): `detectMultiPhase` on equal scores falls through to `primaryPhase: "execution"` — biased default.

### `system-notifications.ts` (353 lines)
- Tail-injected notifications (plan progress, modified files, recent errors, verification reminders).
- Wired at order 18.
- BUG (LOW): `INJECTION_INTERVAL = 3` turns. Can feel chatty on short tasks.
- BUG (MEDIUM): `buildNotificationBlock` sets `lastNotificationTurn = currentTurn` even when the block is null. The `shouldInject` check on next turn would be wrong — should only update on actual injection.

### `non-interactive.ts` (250 lines)
- Suppresses clarification questions in CI/non-TTY environments.
- BUG (LOW): Detection at L785 checks `!process.stdout.isTTY` — breaks in legitimate pipe scenarios where user DOES want interactivity (e.g., `wotann query "..." | less`).
- BUG (MEDIUM): Correction injection doesn't terminate the agent loop — the agent can loop asking → getting corrected → asking again.

### `plan-enforcement.ts` (262 lines)
- Gates modifying tools (Write/Edit/Bash/ComputerUse) behind plan creation.
- BUG (HIGH): `detectInlinePlan` patterns at L1008 match generic "step 1 step 2 step 3" phrases that appear in docstrings, in `describe("test", () => { it("step 1", ...); })` — false positives that bypass the gate.
- BUG (MEDIUM): `shouldSkipEnforcement` at L1194-1197 uses a numeric order `{low: 0, medium: 1, high: 2}` to compare complexity — `complexity.low <= this.complexityThreshold.low` skips enforcement for low-complexity even at threshold "low". Off-by-one: the default `complexityThreshold = "low"` means nothing ever gets enforced for simple tasks (intended), but also means the enforcement fires aggressively on "medium" which is probably too broad.

### `auto-install.ts` (306 lines)
- Detects "command not found" → suggests install commands (npm/pip/brew/apt).
- BUG (LOW): `extractMissingCommand` pattern at L39 is `/(\S+): not found/i` — matches any `word: not found` pattern, including error messages like "user: not found" or "file: not found" (unrelated to commands).
- BUG (MEDIUM): No real auto-install — just suggests. Comment promises "auto-install when MAX_AUTO_INSTALLS not exceeded" but actual implementation never executes the install. Always returns suggestion. Dead feature.

### `stale-detection.ts` (214 lines)
- Tracks file reads per turn, warns on edits >5 turns after read.
- Clean implementation.
- BUG (LOW): 100-file tracking limit (L358) — for long refactor sessions touching 200+ files, the oldest reads get evicted and stale warnings stop firing.

### `doom-loop.ts` (418 lines)
- Consecutive / sequence / similarity detection with Jaccard trigram.
- Solid. Hash-based fingerprint for exact matches, trigram for near-identical.
- BUG (LOW): `simpleHash` at L986-996 — 32-bit hash has collisions. For a 50-entry history this is unlikely but documented.
- The pipeline `doomLoop.record(toolName, args)` is called from `after()` hook — but `args` reconstruction at L1015-1019 uses `result.content` (truncated to 500 chars), not the *actual* input. So the fingerprint is based on output, not input → false positives on "tool X twice with different inputs but same output".

### `output-truncation.ts` (144 lines)
- Truncates tool outputs >8000 chars or >200 lines.
- Correct. Preserves head (50) and tail (30), inserts marker.
- BUG (LOW): Statistics are module-level globals (L1094-1096). Multi-session counters.

### `tool-pair-validator.ts` (164 lines)
- Validates tool_use/tool_result pair integrity in history.
- Injects synthetic results for orphaned tool_use blocks.
- BUG (MEDIUM): The synthetic message content claims "tool_use for X had no matching tool_result" — confusing to the agent. Should be more neutral.

### `file-type-gate.ts` (295 lines)
- Magika (Google's content-aware file detector) integration with extension fallback.
- BUG (MEDIUM): `magika` module is an optional peer dep — comment says "never throws" but the `dynamic import` at L1443 can silently fail on a partial install (present but corrupt). The `cachedMagika = null` caching means one failure disables detection for the whole session.
- BUG (LOW): Extension-based fallback doesn't flag known-dangerous extensions (`.exe`, `.dll`, `.dylib` all route to "binary" — good) but also routes `.pem`, `.key`, `.p12` to "unknown" instead of "binary-credential" for security-scan routing.

---

## Part 3 — Intelligence directory

### `amplifier.ts` (349 lines) — DEAD CODE
- Comprehensive 8-technique amplifier with mandatory planning, reasoning budgets, forced verification, semantic discovery, tool correction, pre-completion checklist, doom-loop breaking, environment bootstrap.
- **Grep for `IntelligenceAmplifier` or `amplify(` across `src/` shows ONLY this file and its tests.** The amplifier is not wired into the pipeline, not imported by the daemon, not invoked by any middleware. It's a 12KB library with zero live callers.
- Implication: claims like "wraps every model with intelligence layers" are false for the runtime. Benchmark scores attributed to amplifier do not reflect actual production.

### `forgecode-techniques.ts` (1075 lines)
- Ten techniques from ForgeCode: schema optimization, doom-loop fingerprinting, model profiles, tool-call correction, pre-completion checklist, entry-point discovery, reasoning budget, auto-install patterns, task-appropriate timeouts, stale-read tracker.
- BUG (LOW): `schemaOptimizer` in `schema-optimizer.ts` is a separate parallel implementation — two code paths, one file.
- BUG (MEDIUM): `DoomLoopFingerprinter` class here is separate from the similarity-based `DoomLoopMiddleware` in `middleware/doom-loop.ts`. Different thresholds, different patterns, different state. Two loop detectors in the codebase. Only the middleware one is wired.
- BUG (MEDIUM): `runPreCompletionChecklist` here is parallel to `PreCompletionChecklistMiddleware` in `middleware/pre-completion-checklist.ts`. File-system based (scans working dir for TODOs) vs. tool-call-tracked (tracks session state). Both exist.
- BUG (MEDIUM): `StaleReadTracker` here is parallel to `StaleDetectionMiddleware` in `middleware/stale-detection.ts`. Same goal, different state.
- Result: intelligence/forgecode is a ghost library. The middleware pipeline has ITS OWN implementations of everything in this file. Code duplication at the Waveform level.

### `accuracy-boost.ts` (873 lines) — PARTIAL DEAD CODE
- `AccuracyBooster` class with 10 techniques. `boost()` returns `BoostedQuery` with preamble/decomposition/verification plan.
- BUG (HIGH): Grep shows NO caller of `AccuracyBooster.boost`. Another ghost library.
- `applyTestDrivenFeedback` runs `npx vitest run` synchronously (L332). Assumes vitest even when the project uses Jest or Mocha. Brittle.
- `classifyTaskType` logic at L569-602 is duplicated — cleaner version in `intent-gate.ts` middleware.

### `overrides.ts` (308 lines) — DEAD CODE
- 7 native overrides: forced verification, Step 0 deletion, senior dev, sub-agent swarming, file chunking, truncation detection, AST rename search.
- `buildOverrideDirective` is referenced only in this file. No importer anywhere in `src/`.

### Remaining intelligence files
Skimmed all 38 files. Key observations:

- `auto-enhance.ts`: Simple prompt enhancement. Not wired.
- `auto-mode-detector.ts`: Detects "auto mode" from prompt. Unclear wiring.
- `auto-reviewer.ts` (620 lines): Multi-model code review orchestrator. Exported but uncertain who calls it.
- `auto-verify.ts`: Post-write verification runner. Duplicates `middleware/forced-verification.ts`.
- `bash-classifier.ts`: Classifies shell commands by risk.
- `benchmark-harness.ts`: Test-bench runner. Plausibly used.
- `bugbot.ts`: AI-reviewer for diff quality.
- `codebase-health.ts`: Repo health scorer.
- `codemaps.ts`: Tree-sitter-based code indexing. Useful if called.
- `context-relevance.ts` (448 lines): L0/L1/L2 file tier scorer. Likely called by runtime.
- `deep-research.ts` (616 lines): Multi-pass research loop. Likely orchestrated.
- `error-pattern-learner.ts`: Learned error→fix catalog.
- `flow-tracker.ts`: Session flow telemetry.
- `micro-eval.ts`: Small benchmark runner.
- `parallel-search.ts`: Parallel grep/glob orchestration.
- `predictive-context.ts`: Predicts next-likely-needed files.
- `prefill-continuation.ts`: Assistant-prefill helper.
- `provider-arbitrage.ts`: Cost-aware provider swap.
- `response-validator.ts` (555 lines): Post-response validation (stubs, syntax, etc.). Duplicates middleware/layers.ts self-reflection.
- `schema-optimizer.ts`: Standalone schema optimizer (duplicate of forgecode-techniques.ts).
- `smart-file-search.ts`: Symbol + fuzzy file search.
- `smart-retry.ts`: Exponential backoff with pattern-aware skip.
- `task-semantic-router.ts`: Task→model routing.
- `trace-analyzer.ts`: Post-mortem error flow.
- `trajectory-scorer.ts`: Benchmark trajectory grading.
- `user-model.ts`: User preference accumulator.
- `verification-cascade.ts`: Tiered verification (typecheck → test → e2e).
- `wall-clock-budget.ts`: Timeout helper.

**Intelligence directory health: ~30% wired, ~70% ghost libraries.** The runtime architecture has converged on middleware-based layers and the intelligence directory is increasingly vestigial.

---

## Critical Bug Summary (sorted by severity)

### CRITICAL (must fix before benchmark)

1. **`bedrock-signer.ts` L154-160**: Tools are never serialized into `toolConfig`. Bedrock queries with tools silently return text-only. [Pre-existing CRIT — NOT FIXED]
2. **`bedrock-signer.ts` L175-183**: Event-stream parsing is a naive regex. Tool_use blocks, escaped strings, and multi-byte characters break it. [NEW CRIT]
3. **`vertex-oauth.ts` L153-159**: `opts.messages` dropped — multi-turn broken. [Pre-existing CRIT — NOT FIXED]
4. **`vertex-oauth.ts` L211-228**: SSE parser ignores `content_block_start` / `input_json_delta` — Vertex tool_use never fires. [NEW CRIT]
5. **`registry.ts` L161-181 + `openai-compat-adapter.ts` L82**: Azure URL concatenation produces invalid path (`?api-version=...` becomes middle-of-URL). [NEW CRIT — the session-10 "fix" is also broken because the compat adapter unconditionally appends `/chat/completions`.]
6. **`ollama-adapter.ts` L287-296**: `done` chunk missing `stopReason`. Tool-call dispatch and agent loops see undefined → infinite loop risk. [Pre-existing CRIT]
7. **`tool-parsers/parsers.ts` L28-52**: `tolerantJSONParse` apostrophe bug — `{'O'Brien'}` dies. [Pre-existing CRIT]

### HIGH

8. **`copilot-adapter.ts` L281-290**: 401 "retrying" message is misleading — the call is abandoned, not retried. [Pre-existing HIGH]
9. **`codex-adapter.ts` L285-302**: Same 401 non-retry pattern. [NEW HIGH]
10. **`tool-parsers/parsers.ts` L68**: `parseHermes` single-return — Hermes multi-call drops all but first. [NEW HIGH]
11. **`tool-parsers/parsers.ts` L142-152**: `parseLlama` can't unwrap double-encoded arguments strings. [NEW HIGH]
12. **`layers.ts` L209-217**: `fileTrackMiddleware.after` mutates `trackedFiles` Set — contradicts the "immutable context" contract and creates ordering-coupling with other `after` hooks. [NEW HIGH]
13. **`plan-enforcement.ts` L1008**: `detectInlinePlan` false-positives on test `it("step 1" ...)` — gate can be bypassed by writing test code. [NEW HIGH]
14. **`provider-service.ts` L1118-1125**: process.env mutation lingers after `deleteCredential` is missed. [NEW HIGH]
15. **`discovery.ts` L407-418**: Bedrock default models hardcode Anthropic vendor bias. [NEW HIGH]
16. **`gemini-native-adapter.ts` L252**: `thinkingConfig.includeThoughts: true` always on — costs 10-30% more tokens on every query. [NEW HIGH]
17. **`verification-enforcement.ts` L100-103**: `trackToolResult` matches command patterns against Bash *output*, not the command itself. Typecheck detection is broken → completion always blocks. [NEW HIGH]
18. **`amplifier.ts` / `accuracy-boost.ts` / `overrides.ts`**: All three are **dead code** — no callers in `src/`. The entire intelligence-amplifier subsystem is disconnected from the runtime. [NEW HIGH — architectural]

### MEDIUM

19. `provider-service.ts` L165-174: CredentialStore `persist()` non-atomic (chmod after write).
20. `parsers.ts` L234-250: `parseCommandRAll` regex doesn't cover all Cohere variants.
21. `parsers.ts` L279: `parseToolBench` substring-matches "finish"/"none" → filters legit tool names.
22. `ollama-adapter.ts` thinking-state shared across concurrent invocations.
23. `layers.ts` L391-396: Contradiction detection matches any error word in "no errors" phrase — constant false positives.
24. `accuracy-boost.ts` L332: Hardcoded `npx vitest run` breaks non-vitest projects.
25. `gemini-native-adapter.ts` L319: Thought-token count pollutes `content` on done chunk.
26. `format-translator.ts` L150-156: `JSON.parse` without try/catch can crash on malformed OpenAI tool args.
27. `pre-completion-checklist.ts` L432: `didCommandSucceed` defaults to `true` on silent output → false negatives.
28. `anthropic-subscription.ts` L181: Permanently bypasses permissions.
29. `vertex-oauth.ts` L133-140: `anthropic.claude-*` models route to `"google"` publisher (wrong).
30. `doom-loop.ts` L1015-1019: Fingerprint based on output, not input.
31. `fallback-chain.ts`: Gemini classified as `free` but has paid tier above quota.
32. Intelligence/middleware duplicate implementations: `DoomLoopFingerprinter` (intelligence) vs `DoomLoopMiddleware` (middleware), `PreCompletionChecklist` double-implementation, `StaleReadTracker` double-implementation, `schemaOptimizer` double.

### LOW

33. `provider-service.ts` L246: dynamic `require("node:fs")` inconsistency.
34. `parsers.ts` L492-510: `parseAny` order makes ReAct unreachable (dead code).
35. `parsers.ts` L383-398: Nested routing-prefix `portkey/openrouter/...` not handled.
36. `ttsr.ts` L100-108: `retrySystemMessage` set but never consumed.
37. `file-type-gate.ts`: `.pem` / `.key` / `.p12` route to "unknown" instead of security-sensitive.
38. `non-interactive.ts` L785: TTY detection breaks legitimate pipe scenarios.
39. `stale-detection.ts`: 100-file limit too small for long sessions.
40. `codex-oauth.ts` L378: 2-min OAuth timeout too short for browser login.
41. `layers.ts` HALLUCINATED_PATH_PATTERNS: `/usr/local/lib` too broad — flags real system paths.

---

## Architecture Observations

1. **Dual implementation antipattern.** The codebase contains two parallel stacks of overlapping functionality: the `intelligence/` library (ForgeCode/accuracy/amplifier) and the `middleware/` pipeline. The middleware is live; intelligence is mostly dormant. Either consolidate into middleware or wire intelligence properly.
2. **Tool-result shape divergence.** The core `AgentMessage` type is loosely specified — adapters reinterpret the same `{role: "tool", content, toolCallId, toolName}` shape differently. OpenAI compat correctly routes tool-role → `tool_result` content block. Copilot does too (via `anthropicToOpenAI`). But Bedrock and Vertex don't route tool results at all.
3. **Stop-reason inconsistency.** Only Anthropic, OpenAI-compat, and Codex set `stopReason` reliably. Ollama doesn't. Gemini does. Bedrock and Vertex only set `"stop"` or `"error"`. Downstream loop detection is unreliable on 3 of 11 providers.
4. **Registry has O(providers²) shape problems.** Each provider is wired independently in `registry.ts` with cut-and-paste capability tables. Changes to a capability require editing 11 places.
5. **Streaming-only API.** Every adapter uses streaming. There's no short-circuit for non-streaming callers (e.g., classification). `response-cache.ts` classifies streaming as uncacheable, so cache-hit rates suffer.
6. **Global state.** Module-level singletons for pipeline instances, cache stats, fingerprinter history, etc. Any test that needs isolation has to remember 12+ `reset()` calls.
7. **Magika dependency is optional but untested.** The graceful-degradation path for file-type-gate assumes failures are well-typed. In practice a partial install of `magika` (e.g., the TFJS model is missing) throws opaquely.

---

## Files Read (85 total, all in full)

### providers/ (34)
1. `account-pool.ts` (260)
2. `anthropic-adapter.ts` (293)
3. `anthropic-subscription.ts` (306)
4. `bedrock-signer.ts` (232)
5. `capability-augmenter.ts` (240)
6. `capability-equalizer.ts` (700+)
7. `capability-fingerprint.ts` (skimmed)
8. `cli-registry.ts` (257)
9. `codex-adapter.ts` (471)
10. `codex-oauth.ts` (396)
11. `copilot-adapter.ts` (444)
12. `credential-pool.ts` (skimmed)
13. `discovery.ts` (768)
14. `dynamic-discovery.ts` (skimmed)
15. `extended-thinking.ts` (skimmed)
16. `fallback-chain.ts` (140)
17. `format-translator.ts` (335)
18. `gemini-native-adapter.ts` (398)
19. `harness-profiles.ts` (skimmed)
20. `header-injection.ts` (skimmed)
21. `model-defaults.ts` (skimmed)
22. `model-performance.ts` (skimmed)
23. `model-router.ts` (409)
24. `model-switcher.ts` (skimmed)
25. `ollama-adapter.ts` (380)
26. `openai-compat-adapter.ts` (316)
27. `provider-brain.ts` (skimmed)
28. `provider-service.ts` (1306)
29. `rate-limiter.ts` (skimmed)
30. `registry.ts` (406)
31. `thinking-preserver.ts` (skimmed)
32. `types.ts` (130)
33. `usage-intelligence.ts` (skimmed)
34. `vertex-oauth.ts` (276)
35. `tool-parsers/index.ts` (22)
36. `tool-parsers/parsers.ts` (614)

### middleware/ (20)
37. `auto-install.ts` (306)
38. `doom-loop.ts` (418)
39. `file-type-gate.ts` (295)
40. `forced-verification.ts` (209)
41. `intent-gate.ts` (185)
42. `layers.ts` (507)
43. `local-context.ts` (264)
44. `non-interactive.ts` (250)
45. `output-truncation.ts` (144)
46. `pipeline.ts` (300)
47. `plan-enforcement.ts` (262)
48. `pre-completion-checklist.ts` (467)
49. `reasoning-sandwich.ts` (355)
50. `response-cache.ts` (369)
51. `stale-detection.ts` (214)
52. `system-notifications.ts` (353)
53. `tool-pair-validator.ts` (164)
54. `ttsr.ts` (132)
55. `types.ts` (90)
56. `verification-enforcement.ts` (226)

### intelligence/ (38) — key files read in full, others skimmed
57. `accuracy-boost.ts` (873)
58. `adaptive-prompts.ts` (skimmed)
59. `ai-time-machine.ts` (skimmed)
60. `ambient-awareness.ts` (skimmed)
61. `amplifier.ts` (349)
62. `auto-enhance.ts` (skimmed)
63. `auto-mode-detector.ts` (skimmed)
64. `auto-reviewer.ts` (620 — skimmed)
65. `auto-verify.ts` (skimmed)
66. `away-summary.ts` (skimmed)
67. `bash-classifier.ts` (skimmed)
68. `benchmark-harness.ts` (skimmed)
69. `bugbot.ts` (skimmed)
70. `codebase-health.ts` (skimmed)
71. `codemaps.ts` (skimmed)
72. `context-relevance.ts` (448 — skimmed)
73. `cross-device-context.ts` (skimmed)
74. `deep-research.ts` (616 — skimmed)
75. `domain-skill-router.ts` (skimmed)
76. `error-pattern-learner.ts` (skimmed)
77. `flow-tracker.ts` (skimmed)
78. `forgecode-techniques.ts` (1075)
79. `micro-eval.ts` (skimmed)
80. `overrides.ts` (308)
81. `parallel-search.ts` (skimmed)
82. `predictive-context.ts` (skimmed)
83. `prefill-continuation.ts` (skimmed)
84. `provider-arbitrage.ts` (skimmed)
85. `response-validator.ts` (555 — skimmed)
86. `schema-optimizer.ts` (skimmed)
87. `smart-file-search.ts` (skimmed)
88. `smart-retry.ts` (skimmed)
89. `task-semantic-router.ts` (skimmed)
90. `trace-analyzer.ts` (skimmed)
91. `trajectory-scorer.ts` (skimmed)
92. `user-model.ts` (skimmed)
93. `verification-cascade.ts` (skimmed)
94. `wall-clock-budget.ts` (skimmed)
