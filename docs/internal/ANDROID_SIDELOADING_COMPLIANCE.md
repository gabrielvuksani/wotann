# Android Developer Verification — Sept 2026 Compliance Prep

> **V9 T14.12** — pre-register WOTANN's Android developer identity
> before the Sept 2026 sideloading-verification enforcement begins
> in BR/ID/SG/TH (Brazil, Indonesia, Singapore, Thailand). The free
> hobbyist tier has a 20-device cap; commercial distribution
> requires the $25 one-time developer registration.
>
> **Status**: pending user action (this doc captures the steps).

## Why this matters

Google's Sept 2026 enforcement requires every APK installed via
sideloading on devices in BR/ID/SG/TH to be signed by a verified
developer identity. WOTANN's eventual Android tier (FT.3 in V9)
ships as a sideloadable APK from F-Droid + GitHub Releases — both
distribution channels require verified signing.

The hobbyist tier is free but capped at 20 devices, which is fine
for the pre-launch beta. Commercial distribution (>20 devices)
requires the $25 one-time fee + business registration + verified
website.

Registering NOW (before launch) avoids:

1. A pre-launch scramble when verification turnaround takes 2-4 weeks
2. The risk of being caught flat-footed if Google expands
   enforcement beyond the initial 4 countries
3. The friction of asking early beta testers to side-load an
   unverified APK

## Steps (user-only)

### 1. Decide tier

| Tier | Cost | Device cap | Use when |
|---|---|---|---|
| Hobbyist (free) | $0 | 20 devices | Pre-launch beta, friends/family testing |
| Commercial | $25 one-time | unlimited | Public sideload distribution |

**Recommendation**: start with Hobbyist for the closed beta. Upgrade
to Commercial before public F-Droid + GitHub Releases push.

### 2. Required artifacts (commercial tier)

- Verified business name + registration document
- Verified website URL (DNS-verifiable; wotann.com qualifies)
- Verified email address on the verified domain
- Government-issued ID for the registering individual

### 3. Submission flow

1. Visit https://developer.android.com/distribute/console
2. "Sign up as Android Developer" → choose tier
3. Upload signing key public certificate (`keytool -exportcert -alias wotann -keystore wotann.keystore`)
4. Submit identity verification (turnaround: 2-4 weeks)
5. Receive verified-developer credential (a JWT-style identity token)
6. Configure release pipeline to attach the credential to every signed APK

### 4. Signing key management

> **Do not commit signing keys to the repo.** Per the WOTANN
> security policy, all secrets live outside source control.

Recommended:

- Generate the key locally:
  ```sh
  keytool -genkey -v \
    -keystore wotann-release.keystore \
    -alias wotann \
    -keyalg RSA \
    -keysize 4096 \
    -validity 25000
  ```
- Store the keystore in 1Password (or a hardware token) — back it up
  to two physical locations.
- Add the keystore path + alias + password to GitHub Actions secrets
  (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEYSTORE_PASSWORD`) so the release workflow can sign APKs
  without ever touching the local filesystem.

## Implementation in WOTANN

When the FT.3 Android tier ships, the release pipeline should:

1. Accept the keystore from GHA secrets
2. Sign the APK
3. Attach the verified-developer credential
4. Push the signed APK to GitHub Releases + F-Droid metadata repo

Concrete artifact: `.github/workflows/android-release.yml` (does
not exist yet — adds after FT.3 implementation lands).

## Timeline

| When | What | Owner |
|---|---|---|
| Now | Read this doc, decide tier | User |
| Now (1 hour) | Sign up at developer.android.com | User |
| ~2 weeks | Receive verification | (waiting) |
| Pre-FT.3 | Upgrade to commercial tier if launching publicly | User |
| FT.3 ship | Wire the keystore to GHA | Engineer |

## Cost summary

- $25 one-time fee for commercial tier
- $0 for hobbyist tier
- $0 for the registration itself (Google does not charge for verification)

This is a fixed cost — the user pays Google directly. WOTANN's repo
or developer wallet is not involved.

## References

- Google Android Developer Verification: https://support.google.com/googleplay/android-developer/answer/13290030
- Sideloading enforcement scope: https://developer.android.com/distribute/marketing-tools/linking-to-google-play (BR/ID/SG/TH from Sept 2026)
- F-Droid metadata format: https://f-droid.org/docs/Build_Metadata_Reference/
