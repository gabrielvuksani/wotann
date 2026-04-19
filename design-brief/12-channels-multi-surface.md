# 12 — Channels: how 25+ adapters surface in the UI

Source: `wotann/docs/SURFACE_PARITY_REPORT.md` §4.11 + `wotann/src/channels/` (25 TS files).

WOTANN's dispatch plane speaks 17 gateway-native channel adapters + IMessage + GitHubBot + IDEBridge today, with 7 more spec'd. Channels are **daemon-side** concerns; the UI's job is to surface status, enable configuration, and route tasks in/out.

## The 17 wired adapters (inbound + outbound verified)

From `src/daemon/kairos.ts:736-1062`:

1. **Telegram** — in+out (bot token + webhook).
2. **Slack** — in+out (Socket Mode + Events API).
3. **Discord** — in+out.
4. **Signal** — in+out.
5. **WhatsApp** — in+out (via Baileys).
6. **Email** — in+out.
7. **Webhook** — in+out (generic HTTP).
8. **SMS** — in+out.
9. **Matrix** — in+out.
10. **Teams** — in+out.
11. **IRC** — in+out.
12. **GoogleChat** — in+out.
13. **WebChat** — in+out.
14. **iMessage** — in+out (macOS bridge, AppleScript).
15. **GitHubBot** — in+out (webhook only; separate accessor `getGitHubBot()`).
16. **IDEBridge** — in+out (separate accessor on port 7742).

## The 7 spec'd-but-missing adapters

From `SURFACE_PARITY_REPORT.md` §4.11 "Missing from 24-adapter spec":

- Mastodon, Twitter/X DM, LinkedIn, Instagram, WeChat, Line, Viber.

These will be added to the same `Settings > Channels` UI once implemented.

## How channels appear on each surface

### Desktop — Settings > Channels section

Source: `wotann/desktop-app/src/components/settings/ChannelsTab` + `ChannelStatus`.

Per channel:
- **Status chip** — Connected (moss) / Disconnected (blood) / Not configured (muted),
- **Last message timestamp**,
- **Token count today**,
- **Enable/Disable toggle**,
- **Configure** button → opens credential form (OAuth or token input),
- **Test message** button → sends a roundtrip.

17 cards in a grid (3 columns at 1200px, 2 at 900px, 1 at 600px).

### Desktop — DispatchInbox (primary workshop view)

Source: `wotann/desktop-app/src/components/dispatch/DispatchInbox.tsx`.

Unified view of incoming messages across all channels:

```
┌──── Dispatch Inbox ──────────────────────────────────────────────────┐
│  [ All ]  [ Telegram ]  [ Slack ]  [ Discord ]  [ iMessage ]  [ GH ] │
│                                                                       │
│  ᚱ  Slack / #engineering · 14:23                                     │
│     @alice: Can you review PR #42?                                    │
│     → Task routed to: autonomous executor (eta 4m)                   │
│                                                                       │
│  ᛒ  Telegram / @alice · 14:18                                        │
│     Running low on credits — check budget                             │
│     → Task routed to: cost-check skill (complete, $0.04 today)       │
│                                                                       │
│  ᛗ  iMessage / Mom · 13:02                                           │
│     Happy birthday!                                                   │
│     → Not a task — archived (human message)                          │
└──────────────────────────────────────────────────────────────────────┘
```

Each row: icon + source + timestamp + message preview + routing verdict.

### iOS — Settings > Channels (read-only)

Source: `ios/WOTANN/Views/Channels/ChannelStatusView.swift`.

**Current**: read-only list showing `channels.status` RPC output. iOS cannot configure adapters today.

**Target**: read-only remains the default (daemon holds tokens), but add:
- Per-channel toggle for iOS notifications (suppress Telegram notifications on iPhone while Mac is unlocked),
- Per-channel test-message trigger.

### iOS — Work tab > Dispatch

`ios/WOTANN/Views/Dispatch/DispatchView.swift` + `TaskTemplateList.swift`.

Same IA as desktop DispatchInbox, but:
- Filter chips as horizontal scroll,
- Each task is a card, swipe left to archive, right to complete,
- Haptic: `swipeAccept` / `swipeReject`.

### iOS — Share Extension (inbound)

`WOTANNShareExtension/`:
- User taps Share in any app → "Send to WOTANN."
- Share sheet shows 3 options: Chat / Dispatch task / Memory save.
- Routing metadata attached.

### TUI — `/channels` slash command

- `/channels status` — table of connected channels + stats.
- `/channels start telegram` — start a specific adapter.
- `/channels policy-ask-threshold 0.8` — set approval threshold.

No primary TUI view for channels today — they appear in the DispatchInbox component instead.

## Channel routing UI — what happens when a message arrives

Flow:
1. Inbound message hits channel adapter in daemon.
2. `UnifiedDispatchPlane` evaluates via `route-policies.ts` (currently DEAD — 412 LOC unused; must wire per `SURFACE_PARITY_REPORT.md` §4.11 "Dead channel files").
3. Policy decides: auto-route / ask-user / reject.
4. If ask-user: push to `ExecApprovals` (desktop) or `AgentTriage` (iOS/Watch).
5. On approval: task dispatched to executor with provenance metadata (channel + sender + conversation ID).
6. Reply posted back to originating channel + logged to `~/.wotann/audit.log`.

**UI implications**:
- **Desktop**: ExecApprovals panel shows a card for each pending dispatched task.
- **iOS**: Work > Dispatch shows it; Watch AgentTriageView gets a notification with Approve / Deny.
- **Lock-screen notification**: "WOTANN has 3 new tasks from Slack. [View]"

## Provenance chip (cross-surface)

Every assistant message has a "provenance chip" showing:
- Which channel the initial request came from,
- Which model answered,
- Cost.

```
[ Slack / #eng ]  [ opus ◈ 1M ]  [ 🜂 vision ]  [ $0.04 ]  [ ⚒ 7a3f2 ]
```

Chips are defined in `CapabilityChips.tsx` (already exists on desktop, not yet consumed). Claude Design: wire this into every assistant message bubble.

## Channel icons (design ambition)

Rule: **NO emoji in system UI.** Channel icons must be:
- Custom 16px SVG per channel (Telegram paper-plane, Slack hashmark-in-box, Discord crescent, etc.),
- Single-color (currentColor) so they tint with theme,
- Rendered at 16px for list rows, 24px for status cards, 40px for detail headers.

Alternative (for channels that lack a clean svg): use the Elder Futhark rune that most closely matches the channel's semantic:

| Channel | Rune | Meaning |
|---|---|---|
| Telegram | `ᚱ` Raidho | journey, running |
| Slack | `ᚷ` Gebo | gift, handoff |
| Discord | `ᚲ` Kenaz | torch, discovery |
| iMessage | `ᛗ` Mannaz | human / interpersonal |
| Email | `ᛒ` Berkano | growth, new message |
| GitHub | `ᚺ` Hagalaz | change, transformation |
| Webhook | `ᛟ` Othala | inheritance (data flow) |

This is an *opt-in* experience — in default theme, channels use their real svgs; in Runestone / Bifrost themes, runes may be toggled on.

## Channel-originated conversation provenance

When a conversation starts from a channel (not from the app itself):
- Conversation title uses channel context: "Slack #engineering — PR review",
- First message has provenance chip: `[ Slack / #engineering ]`,
- Shadow-git commit message includes: `chat: respond via slack to alice@team`.

Claude Design: add a "channel stripe" at the top of such conversations — 2px colored bar matching the channel's accent color.

## Channels that are dead today

From `SURFACE_PARITY_REPORT.md` §4.11:

- `src/channels/route-policies.ts` — 412 LOC policy engine, daemon bypasses it. **Must wire.**
- `src/channels/auto-detect.ts` — only supports 4 of 17 adapters; the other 13 are hand-wired in kairos.ts. **Expand.**
- `src/channels/terminal-mention.ts` — 116 LOC, not imported anywhere. **Wire or delete.**

**UI implications**: once `route-policies.ts` is wired, surface the policy engine as a first-class Settings > Channels > Routing Policies pane.

## Multi-surface consistency checklist

For every adapter:

- [ ] Status shown in Settings > Channels (desktop + iOS).
- [ ] Inbound messages appear in DispatchInbox (desktop + iOS).
- [ ] Outbound messages trigger Raven's Flight animation on the originating surface.
- [ ] Approval-required messages push to ExecApprovals (desktop) / AgentTriage (iOS + Watch).
- [ ] Audit log entry on every message (source + sender + routing decision).
- [ ] Provenance chip on every assistant response.

---

*End of 12-channels-multi-surface.*
