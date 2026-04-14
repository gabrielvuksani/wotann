# WOTANN — Developer Credentials Needed (Gabriel)

These are credentials YOU (the developer) need to provide so features work in the build. Users won't need to configure these — they'll be baked into the app or auto-configured.

## Required for Remote iOS Access
- [ ] **Supabase Project URL** — Create free project at https://supabase.com/dashboard
- [ ] **Supabase Anon Key** — Settings → API → `anon` `public` key
- These get embedded in the app so remote iOS access works for ALL users out of the box
- Provide values and I'll set them in `src/desktop/supabase-relay.ts`
Response: Supabase Project URL: https://djrgxboeofafvfgegvri.supabase.co
As for the anon key, I can only find the publishable key: sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT - does that work?

## Required for Push Notifications (iOS) 
- [ ] **Apple Developer Account** ($99/yr) — needed to deploy to App Store and for APNs
- [ ] **APNs Key** — Apple Developer Portal → Certificates → Keys → APNs key
Response from dev: I dont have an Apple dev account as of yet. Get it working for free for now.

## Optional for Testing
- [ ] **ANTHROPIC_API_KEY** — for testing Claude integration
- [ ] **OPENAI_API_KEY** — for testing OpenAI integration
- [ ] **GOOGLE_API_KEY** — for testing Gemini (free tier)
- [ ] Your preferred provider keys for development testing

## No Credentials Needed
- Ollama + Gemma 4: bundled, works offline
- Web Speech API: built into browser
- LocalSend: peer-to-peer, no server
- All skills, modes, memory, Computer Use: local
