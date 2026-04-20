# SECURITY — Supabase Blob Triple-Check

**Blob:** `dbaf1225fc899fb9e0674fe487e5d1cbf7e94910` (`CREDENTIALS_NEEDED.md`, 1556 bytes)
**Date:** 2026-04-20
**Auditor:** Opus 4.7 max-effort, read-only triple verification
**Precipitating claim:** User believes "I removed the Supabase key from GitHub"
**Prior contradictions:** Lane 4 said "STILL in history," direct grep returned empty, agent said "cat-file exit 0."

---

## 0. Verdict-First Executive Summary

**The Supabase credentials are STILL PUBLICLY EXPOSED.** Three independent paths confirm it:

1. **Local repo:** Blob `dbaf1225` is present in the pack file `pack-48efd3f54...pack` at offset 144,333,984. It is reachable from **seven refs**: `main`, `origin/main`, `origin/release/v0.4.0` (stale local mirror), tags `v0.1.0` and `v0.4.0`, plus all five stashes `stash@{0}`–`stash@{4}`. `git fsck --dangling` does NOT list `dbaf1225` — meaning it is **fully reachable**, not floating garbage that `git gc` would prune.
2. **GitHub remote (public repo):** The GitHub Blob API returns **HTTP 200** with full content at `/repos/gabrielvuksani/wotann/git/blobs/dbaf1225...` — including the literal strings `https://djrgxboeofafvfgegvri.supabase.co` and `sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT`. Raw file endpoint `raw.githubusercontent.com/gabrielvuksani/wotann/v0.1.0/CREDENTIALS_NEEDED.md` also returns **HTTP 200** with the same body. Anyone with the repo URL can read it without authentication.
3. **Key status:** The commit message for `cb55d53` (the deletion commit) explicitly notes *"key MUST be rotated manually at supabase.com/dashboard."* There is no evidence in commit history, release notes, or audit docs that rotation has occurred. Gabriel's memory files reference the blob as an open CRITICAL finding across at least five audit documents.

**Why the prior agents contradicted each other:** The "direct grep returned zero" result came from running `git rev-list --all --objects | grep dbaf1225` — which silently **aborts with `fatal: bad object refs/stash 2`** before enumerating a single object. The broken ref is a stray file `.git/refs/stash 2` (note the literal space) that fails `--all`'s ref walk but does NOT affect per-ref walks. Every per-ref `git rev-list --objects <ref>` call finds the blob. The user's belief that the blob was removed appears to stem from the file being deleted at `HEAD` of `main` (`git show HEAD:CREDENTIALS_NEEDED.md` returns 404) — but the GIT HISTORY still carries the blob and GitHub preserves it indefinitely as long as any ref (including tag `v0.1.0`) keeps it reachable.

**Severity triage:** The key prefix is `sb_publishable_` — Supabase's PUBLISHABLE anon key, designed to be exposed to browsers. It is NOT a service-role key. However: (a) it authenticates as the anon role against whatever RLS policies the project has configured, (b) if RLS is permissive or absent the anon role may read/write user data, (c) it binds the project to a known-public URL which makes targeted enumeration attacks easier, (d) policy is that ALL keys leaked to public git get rotated. **Classify CRITICAL until rotation proof is posted.**

---

## 1. Evidence — Step A — Blob Presence

**Command:** `git cat-file -e dbaf1225fc899fb9e0674fe487e5d1cbf7e94910`
**Exit code:** 0
**Interpretation:** Object exists in the object database.

**Command:** `git cat-file -t dbaf1225`
**Output:** `blob`

**Command:** `git cat-file -p dbaf1225 | head`
**Output (first 12 lines):**
```
# WOTANN — Developer Credentials Needed (Gabriel)

These are credentials YOU (the developer) need to provide so features work in the build. Users won't need to configure these — they'll be baked into the app or auto-configured.

## Required for Remote iOS Access
- [ ] **Supabase Project URL** — Create free project at https://supabase.com/dashboard
- [ ] **Supabase Anon Key** — Settings → API → `anon` `public` key
- These get embedded in the app so remote iOS access works for ALL users out of the box
- Provide values and I'll set them in `src/desktop/supabase-relay.ts`
Response: Supabase Project URL: https://djrgxboeofafvfgegvri.supabase.co
As for the anon key, I can only find the publishable key: sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT - does that work?
```

Blob storage location — verified by `git verify-pack -v`:
```
dbaf1225fc899fb9e0674fe487e5d1cbf7e94910 blob   1556 854 144333984
```
The blob lives inside `.git/objects/pack/pack-48efd3f54a965d5d74c5e4b63acb7aaec0d46a4d.pack` at byte offset 144,333,984. Size on disk: 854 bytes (delta compressed from 1,556 bytes raw). No loose copy exists under `.git/objects/db/af...`.

---

## 2. Evidence — Step B — Reachability

**`git fsck --dangling`:** `dbaf1225` does NOT appear in the output (manually grepped the full list of dangling blobs). `fsck` only prints a blob as "dangling" if it is NOT reachable from any ref. Absence from this list is direct proof that the blob IS reachable.

**Per-ref walk — definitive:**
```
$ for ref in $(git for-each-ref --format="%(refname)"); do
    git rev-list --objects "$ref" | grep dbaf1225 && echo "FOUND in $ref"
  done

=== refs/heads/main ===                    dbaf1225... CREDENTIALS_NEEDED.md   FOUND
=== refs/remotes/origin/HEAD ===           dbaf1225... CREDENTIALS_NEEDED.md   FOUND
=== refs/remotes/origin/main ===           dbaf1225... CREDENTIALS_NEEDED.md   FOUND
=== refs/remotes/origin/release/v0.4.0 === dbaf1225... CREDENTIALS_NEEDED.md   FOUND
=== refs/stash ===                         dbaf1225... CREDENTIALS_NEEDED.md   FOUND
=== refs/tags/v0.1.0 ===                   dbaf1225... CREDENTIALS_NEEDED.md   FOUND
=== refs/tags/v0.4.0 ===                   dbaf1225... CREDENTIALS_NEEDED.md   FOUND
```

**Stashes:** blob found in `stash@{0}` through `stash@{4}` (all five).

**Why prior `git rev-list --all --objects | grep dbaf1225` returned empty:**
```
$ git rev-list --all --objects 2>&1 | grep dbaf1225
(empty)

$ git rev-list --all --objects 2>&1 | head -3
fatal: bad object refs/stash 2
fatal: bad object refs/stash 2
```
The broken ref file `.git/refs/stash 2` (literal space in filename, 41 bytes, mode 0600, dated Apr 19 13:49) makes `git for-each-ref` issue `error: refs/stash 2: badRefName: invalid refname format`, which causes `rev-list --all` to abort with `fatal: bad object refs/stash 2` and output NOTHING. This is the ONLY reason the prior agent's grep came back empty. **It was a false negative — not proof of removal.**

Cleaning this broken ref (`rm ".git/refs/stash 2"`) would restore `rev-list --all --objects` to normal operation. It should be done but is orthogonal to the blob exposure.

---

## 3. Evidence — Step C — Refs Scan

```
$ git for-each-ref --format="%(refname)"
warning: ignoring ref with broken name refs/stash 2
refs/heads/main
refs/remotes/origin/HEAD
refs/remotes/origin/main
refs/remotes/origin/release/v0.4.0
refs/stash
refs/tags/v0.1.0
refs/tags/v0.4.0

$ git stash list
stash@{0}: WIP on release/v0.4.0: 59970ae feat(release+site): v0.4.0 release scaffolding ...
stash@{1}: On main: non-wave-3b-3
stash@{2}: On main: non-wave-3b-2
stash@{3}: On main: non-wave-3b
stash@{4}: On main: wave3c-progress
```

**Tag anchor points:**
- `v0.1.0` (annotated tag dated Apr 14 13:32:34 2026) → commit `72e073d...`. **This commit was made BEFORE `cb55d53` (the deletion commit, dated Apr 14 23:16:22).** Therefore `git show v0.1.0:CREDENTIALS_NEEDED.md` SUCCEEDS — the file IS in the v0.1.0 tree snapshot.
- `v0.4.0` → commit `59970ae...`. Made AFTER `cb55d53`. `git show v0.4.0:CREDENTIALS_NEEDED.md` → "does not exist in 'v0.4.0'". BUT `git rev-list --objects v0.4.0` still enumerates the blob because v0.4.0 descends from `993d661` (commit that added the file) via ancestor traversal.
- `git merge-base --is-ancestor cb55d53 v0.1.0` → NOT ancestor (tag predates deletion). `cb55d53 is ancestor of v0.4.0` → YES.

**Deletion commit:**
```
$ git log -p --diff-filter=AD --oneline -- CREDENTIALS_NEEDED.md | head
cb55d53 sprint 0: immediate security + unblock fixes (13 items)
diff --git a/CREDENTIALS_NEEDED.md b/CREDENTIALS_NEEDED.md
deleted file mode 100644
index dbaf122..0000000
```

---

## 4. Evidence — Step D — GitHub Remote

**Repository visibility (GitHub API):**
```
GET https://api.github.com/repos/gabrielvuksani/wotann → 200
  visibility: public
  private:    False
```

**Blob API fetch:**
```
GET https://api.github.com/repos/gabrielvuksani/wotann/git/blobs/dbaf1225fc899fb9e0674fe487e5d1cbf7e94910
  HTTP_STATUS: 200
  Response: { "sha": "dbaf1225fc899fb9e0674fe487e5d1cbf7e94910",
              "node_id": "B_kwDOSCmsfdoAKGRiYWYxMjI1ZmM4OTlmYjllMDY3NGZlNDg3ZTVkMWNiZjdlOTQ5MTA",
              "size": 1556,
              "content": "...base64..." }
```
Base64-decoded content (verified with `python3 base64.b64decode`) contains the literal strings `djrgxboeofafvfgegvri.supabase.co` and `sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT`.

**Raw-content URL probes:**
| URL | Status |
|---|---|
| `.../wotann/main/CREDENTIALS_NEEDED.md` | 404 (file deleted at main tip) |
| `.../wotann/v0.1.0/CREDENTIALS_NEEDED.md` | **200** (live download path) |
| `.../wotann/v0.4.0/CREDENTIALS_NEEDED.md` | 404 (tree doesn't contain it) |
| `.../wotann/release/v0.4.0/CREDENTIALS_NEEDED.md` | 404 (tree doesn't contain it) |
| `.../wotann/993d661/CREDENTIALS_NEEDED.md` | **200** (commit SHA-addressed, live) |
| `.../wotann/cb55d53a24fad4e64a817a9ea0f3e04ae8bf177c/CREDENTIALS_NEEDED.md` | 404 (deletion commit tree) |
| `.../wotann/48569e83/CREDENTIALS_NEEDED.md` | 404 (current main HEAD) |

**Remote refs on GitHub (`git ls-remote origin`):**
```
48569e83... HEAD
48569e83... refs/heads/main
a535512e... refs/pull/1/head
b7291fed... refs/tags/v0.1.0
72e073d5... refs/tags/v0.1.0^{}
59970ae5... refs/tags/v0.4.0
```
Seven remote refs. Tag `v0.1.0` is the exposure vector: anyone running `git clone https://github.com/gabrielvuksani/wotann` receives a repo where `git show v0.1.0:CREDENTIALS_NEEDED.md` prints the key.

**PR #1** (refs/pull/1/head → `a535512e`): `git rev-list --objects a535512e` finds `dbaf1225`. Raw URL returns 404 at the PR head's tree, but the blob is still server-side reachable through the PR ref.

---

## 5. Evidence — Step E — Sibling Backup Directory

Lane 4 and the docs-gap audit mention a `wotann-old-git-20260414_114728/` backup directory (allegedly 685 MiB). Exhaustive search:
```
$ find /Users/gabrielvuksani -maxdepth 5 -iname "wotann-old-git*" → (no results)
$ find /Users/gabrielvuksani/Desktop -maxdepth 3 -type d | grep -iE "old|backup|archive" → (no results)
```
**No such directory exists on this host at time of this audit.** Either it was deleted between Lane 4's scan and today, never existed under that exact name, or lives outside `/Users/gabrielvuksani`. This reduces the local-disk attack surface compared to Lane 4's claim but does NOT change the remote exposure status.

---

## 6. Evidence — Step F — Leak Recurrence in Working Tree

```
$ grep -rn "djrgxboeofafvfgegvri\|sb_publishable_dXKh" /Users/gabrielvuksani/Desktop/agent-harness/wotann
docs/internal/AUDIT_CURRENT_STATE_VERIFICATION.md  (audit doc references)
docs/internal/AUDIT_LANE_4_INFRA_SECURITY.md        (audit doc references)
```
Only two audit files reference the URL/key — both are internal audit documentation that needs these strings to name the finding. **Source tree itself is clean** (`src/`, configs, scripts contain no leak). These audit files must NOT be pushed to origin until Supabase rotation is complete; otherwise they re-expose the already-expired blob SHA as searchable text. Check with `git status docs/internal/` before next push.

---

## 7. Evidence — Step G — CREDENTIALS_NEEDED.md History

```
$ git log --diff-filter=AD --oneline -- CREDENTIALS_NEEDED.md
cb55d53 sprint 0: immediate security + unblock fixes (13 items)  ← deletion
993d661 WOTANN: Phase 14 — 12 ship-blockers closed               ← creation
```
Only two commits touched the file:
- `993d661` (Phase 14) introduced the file with the Supabase URL + key in-line with the dev conversation.
- `cb55d53` (sprint 0, S0-1) deleted the file. Commit message explicitly states: *"NOTE: key MUST be rotated manually at supabase.com/dashboard"* — i.e. even the deletion commit's author knew that deletion is not enough, yet rotation was not completed.

No filter-branch, BFG, or force-push-with-filter operation has been performed. Git history was not rewritten; the blob was simply dropped from future trees.

---

## 8. Evidence — Step H — Object Database Scan

```
$ find .git/objects -type f
  one pack: pack-48efd3f54a965d5d74c5e4b63acb7aaec0d46a4d.{idx,pack,rev}

$ ls .git/objects/db/ | grep ^af
  (no loose object for dbaf1225 → object is packed)

$ git verify-pack -v .git/objects/pack/pack-48efd3f54...idx | grep dbaf1225
  dbaf1225fc899fb9e0674fe487e5d1cbf7e94910 blob   1556 854 144333984
```
The blob is stored inside the primary pack file at offset 144,333,984. Size: 854 bytes on disk, 1,556 bytes uncompressed. Running `git gc` right now would NOT prune it because it is reachable from `main` + tags + stashes. Even `git gc --prune=now` would keep it for the same reason.

To actually purge it from the local pack you would need (a) remove every reference keeping it alive, then (b) run `git reflog expire --expire=now --all && git gc --prune=now --aggressive`. Step (a) requires either deleting/rewriting the tags `v0.1.0` and `v0.4.0`, clearing the stashes, or using `git filter-repo` / BFG to rewrite every commit that references the blob and then force-push.

---

## 9. Residual Risk

Even if the user performs a full git history rewrite today, the key should be considered compromised:

1. **GitHub caches forever by default.** The blob has been publicly readable since the `v0.1.0` tag was pushed (Apr 14) — roughly 6 days at the time of this audit. GitHub's own guidance (docs.github.com, "Removing sensitive data from a repository") states that even after history rewrite + force push, cached views and forks may retain the content. **Rotation is non-negotiable regardless of git cleanup.**
2. **Secret-scanning bots crawl public repos continuously.** Services like TruffleHog, GitGuardian, and GitHub's own secret scanning index new tags within minutes. If Supabase's partner secret-scanning integration is enabled, Supabase may have ALREADY been notified and auto-rotated — but this is project-specific behavior that must be verified on the Supabase dashboard.
3. **PR #1 still references the blob.** Remote ref `refs/pull/1/head` (SHA `a535512e`) is server-side reachable via `rev-list --objects`. PR refs on GitHub cannot be deleted by the user — only by closing the PR AND purging via GitHub Support request.
4. **Five local stashes** (`stash@{0..4}`) each carry the blob. If the user pushes any of these accidentally (e.g. `git push origin stash@{0}:refs/heads/backup`), they re-expose it. They are currently LOCAL only, which limits risk to this machine.
5. **The broken `refs/stash 2` file** is a data-integrity concern. It causes every `--all` operation to abort. If it's a corrupt duplicate of a valid stash, running `git stash drop` would not remove it (it's not a real stash).
6. **`origin/release/v0.4.0`** is a stale local mirror — the ref no longer exists on the remote (`ls-remote` shows only `main`, `v0.1.0`, `v0.4.0`, `pull/1/head`). This means the blob is NOT exposed via that path on GitHub, but `git remote prune origin` should be run to clean up local state.
7. **Audit docs carry the URL + key as plain text.** `AUDIT_LANE_4_INFRA_SECURITY.md` line 116 and `AUDIT_CURRENT_STATE_VERIFICATION.md` both print the publishable key. If these are committed-and-pushed they become NEW leak vectors with fresh blob SHAs. Check git status before next push or redact them.

---

## 10. Remediation Checklist (exact commands — user action required)

### 10.1 Immediate (blocks all other steps)

```
# On https://supabase.com/dashboard → Project "djrgxboeofafvfgegvri" → Settings → API:
# 1. Click "Reset anon key" (rotates publishable key)
# 2. Confirm old key sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT is REJECTED by:
curl -I -H "apikey: sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT" \
     https://djrgxboeofafvfgegvri.supabase.co/rest/v1/
# Expected after rotation: 401 Unauthorized
```
**Until this is done, everything below is cosmetic.**

### 10.2 Rewrite git history (once rotation is confirmed)

Install `git-filter-repo` (BFG is legacy and riskier):
```
brew install git-filter-repo     # macOS
```
Run (this RE-WRITES every commit that ever referenced CREDENTIALS_NEEDED.md):
```
cd /Users/gabrielvuksani/Desktop/agent-harness/wotann
git filter-repo --path CREDENTIALS_NEEDED.md --invert-paths --force
# Verify blob is gone from object db:
git cat-file -e dbaf1225fc899fb9e0674fe487e5d1cbf7e94910 && echo STILL THERE || echo CLEAN
# Re-create remote (filter-repo removes remotes as safety):
git remote add origin https://github.com/gabrielvuksani/wotann.git
# Force-push all branches + tags:
git push origin --force --all
git push origin --force --tags
```
This rewrites every existing commit's SHA. Anyone with an existing clone will need to re-clone.

### 10.3 Delete tags on remote (they pin the blob)
After filter-repo + force push, `v0.1.0` still exists on GitHub with the OLD SHA pointing at the pre-rewrite commit until explicitly deleted:
```
git push origin :refs/tags/v0.1.0
git push origin :refs/tags/v0.4.0
# Then recreate from new (filtered) history:
git tag -a v0.4.0 <new-SHA-of-corresponding-commit> -m "v0.4.0 (re-tagged post-filter)"
git push origin v0.4.0
```

### 10.4 Clean local cruft
```
rm ".git/refs/stash 2"                      # remove broken ref
git stash clear                             # drop all 5 stashes (blob-bearing)
git remote prune origin                     # remove stale origin/release/v0.4.0
git reflog expire --expire=now --all
git gc --prune=now --aggressive             # purge blob from local pack
git cat-file -e dbaf1225... || echo CLEAN
```

### 10.5 GitHub Support for cached views
Filter-repo + force-push removes the blob from git, but GitHub's browser-visible cached HTML views and the REST API may retain it for up to 90 days. Open a GitHub Support ticket (https://support.github.com/contact/privacy) and state:
> "Please purge cached views of blob dbaf1225fc899fb9e0674fe487e5d1cbf7e94910 and file CREDENTIALS_NEEDED.md from repository gabrielvuksani/wotann. The blob contained leaked credentials that have since been rotated."

### 10.6 Handle PR #1
```
gh pr close 1 --comment "Closing to purge leaked-credential blob from ref pool"
# Then via GitHub Support request deletion of refs/pull/1 per PR ref cleanup docs.
```

### 10.7 Scrub audit docs before next push
```
# Option A: redact the key in docs/internal/AUDIT_LANE_4_INFRA_SECURITY.md line 116 and
#           docs/internal/AUDIT_CURRENT_STATE_VERIFICATION.md — replace the literal
#           "sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT" with "[REDACTED]".
# Option B: keep .gitignore'd — add docs/internal/AUDIT_*.md to .gitignore so they
#           stay local-only. Then `git rm --cached` if already tracked.
```

### 10.8 Verify
```
# Local:
git rev-list --objects --all | grep dbaf1225 && echo STILL THERE || echo CLEAN
find . -type f -exec grep -l 'djrgxboeofafvfgegvri\|sb_publishable_dXKh' {} \;

# Remote:
curl -I https://raw.githubusercontent.com/gabrielvuksani/wotann/v0.1.0/CREDENTIALS_NEEDED.md
# Expected after cleanup: 404
curl -I https://api.github.com/repos/gabrielvuksani/wotann/git/blobs/dbaf1225fc899fb9e0674fe487e5d1cbf7e94910
# Expected after cleanup: 404 or 422

# Supabase:
curl -H "apikey: sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT" \
     https://djrgxboeofafvfgegvri.supabase.co/rest/v1/
# Expected after rotation: 401
```

---

## 11. Agreement / Disagreement with Lane 4

| Claim | Status |
|---|---|
| Lane 4: "Blob is in git history, reachable from main HEAD" | **Agreed** — blob reachable via `main` and six other refs. `git rev-list HEAD --objects \| grep dbaf1225` does return the blob (this specific command works because it only walks `HEAD`, bypassing the broken stash). |
| Lane 4: "`git rev-list --all --objects \| grep dbaf1225` returns the blob" | **Partially disagreed** — as written, that exact command returns EMPTY because of the broken `refs/stash 2` ref. Lane 4 quoted the correct expected behavior but didn't catch that the command is currently broken. Diagnosis: broken ref file. Per-ref walks all find the blob. |
| Lane 4: "Key has not been rotated" | **Agreed** — no evidence of rotation in any commit message, CHANGELOG, release note, or audit doc between `cb55d53` (Apr 14) and HEAD `48569e83` (Apr 20). |
| Docs-gap audit: "`wotann-old-git-20260414_114728/` backup (685 MiB) preserves it independently" | **Cannot confirm** — no directory of that name exists under `/Users/gabrielvuksani/**` at audit time. Either it was deleted since docs-gap ran, lives elsewhere, or was misremembered. If it DOES exist on another host or in Time Machine backups, treat as an additional exposure vector. |
| Prior agent: "direct grep returned zero matches → blob is gone" | **Disagreed** — false negative caused by `fatal: bad object refs/stash 2` aborting `rev-list --all`. The blob is very much still there. |
| Prior agent: "`git cat-file -e dbaf1225` returns exit 0" | **Agreed** — blob exists in the object database. |

---

## 12. One-Page Summary for Gabriel

1. The Supabase publishable key `sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT` on project `djrgxboeofafvfgegvri.supabase.co` is **still publicly readable** at `https://raw.githubusercontent.com/gabrielvuksani/wotann/v0.1.0/CREDENTIALS_NEEDED.md` right now. Also via the GitHub Blob API and via any of 7 refs on your local repo.
2. You deleted the file at the tip of `main`, but tags `v0.1.0` and `v0.4.0` and PR #1 still pin the blob. GitHub keeps it forever as long as at least one ref reaches it.
3. Your prior agent's "it's gone" verdict was a false negative caused by a broken ref file (`.git/refs/stash 2`) that aborted `git rev-list --all`. The blob is packed at offset 144,333,984 in your primary pack file.
4. **Rotate the key TODAY** at supabase.com/dashboard → API → "Reset anon key". This is the only action that reduces actual risk; the git cleanup is secondary cosmetic hygiene.
5. After rotation, run `git filter-repo --path CREDENTIALS_NEEDED.md --invert-paths --force`, force-push everything, delete and recreate the tags, drop the five stashes, remove `.git/refs/stash 2`, close PR #1, and open a GitHub Support ticket to purge cached blob views.
6. Your audit docs (`AUDIT_LANE_4_*.md`, `AUDIT_CURRENT_STATE_*.md`) currently contain the literal key as plaintext. Redact or gitignore before your next push — otherwise you create a NEW blob SHA with the same secret.

**Status by the four questions asked:**

- **Is the blob reachable from any git ref?** YES — 7 refs locally (main, origin/main, origin/release/v0.4.0, tags v0.1.0 + v0.4.0, refs/stash, plus stash@{0..4}) and 4 refs remotely (main, tags v0.1.0 + v0.4.0, pull/1/head). Only v0.1.0 still exposes the file at its tree tip; the others expose the blob via rev-list enumeration.
- **Is the blob in the object database at all?** YES — packed at offset 144,333,984 in `pack-48efd3f54...pack`. Would NOT be pruned by `git gc --prune=now`.
- **Is the blob reachable on GitHub remote?** YES — confirmed HTTP 200 from both the Blob API and the raw-content endpoint. Repo is public.
- **Is the Supabase key rotated?** NO evidence of rotation in commit history, release notes, or audit docs between the leak-introducing commit (`993d661`, Apr 14) and now (`48569e83`, Apr 20). Assume compromised until Supabase dashboard confirms otherwise.
