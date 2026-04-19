# 11 — States inventory

Every view must be designed for every state that applies. Below is the canonical state × view matrix. Claude Design must produce a wireframe / mockup for each non-blank cell.

## The 10 canonical states

| State | Definition |
|---|---|
| **Default** | Normal operating state, has data, engine connected |
| **Empty** | No data (no conversations, no tasks, no findings yet) |
| **Loading** | Fetching / streaming in progress |
| **Streaming** | Live token-by-token fill (assistant response) |
| **Error** | Operation failed — honest error with next action |
| **Success** | Task completed, proof-sealed |
| **Disconnected** | Engine (daemon) offline |
| **Offline** | Device offline (iOS) |
| **Low-battery** | iOS <20% — degraded mode, reduced sync |
| **Focus** | `/focus` collapse active |

## State × Desktop view matrix

| View | Def | Emp | Load | Stream | Err | Succ | Disc | Off | Focus |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| ChatView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| EditorPanel | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| WorkshopView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| ExploitView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| MeetPanel | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| ArenaView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| CouncilView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| IntelligenceDashboard | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| AgentFleetDashboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| ConnectorsGUI | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| DispatchInbox | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| ExecApprovals | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | — | — |
| ComputerUsePanel | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| CanvasView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| DesignModePanel | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| CodePlayground | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| TrainingReview | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| TrustView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| IntegrationsView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| PluginManager | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| ProjectList | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| ScheduledTasks | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — |
| OnboardingView | ✓ | — | ✓ | — | ✓ | ✓ | ✓ | — | — |
| SettingsView | ✓ | — | ✓ | — | ✓ | ✓ | ✓ | — | — |
| CommandPalette | ✓ | ✓ | — | — | — | — | — | — | — |

Total desktop view-state cells: **~180**.

## State × iOS view matrix

| View | Def | Emp | Load | Stream | Err | Succ | Disc | Off | LowBat |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| HomeView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ChatView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Work (Autopilot+Dispatch+TaskMonitor) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MemoryBrowserView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| CostDashboardView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| AgentsView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| ArenaView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| CouncilView (new) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| MeetModeView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| VoiceInputView | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| OnDeviceAIView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| MorningBriefingView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| IntelligenceDashboardView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| SettingsView | ✓ | — | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| DispatchView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| DashboardView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| SkillsBrowserView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| TaskMonitorView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Conversations | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |
| PairingView | ✓ | — | ✓ | — | ✓ | ✓ | — | ✓ | — |
| ExploitView (new) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| RemoteDesktopView (new) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| WorkflowsView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| ChannelStatusView | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — |

Total iOS view-state cells: **~200**.

## State × TUI view matrix

| Component | Def | Emp | Load | Stream | Err | Succ | Disc | Focus |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| StartupScreen | ✓ | — | — | — | ✓ | — | — | — |
| ChatView | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| DiffViewer | ✓ | ✓ | — | — | ✓ | ✓ | — | — |
| AgentStatusPanel | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| HistoryPicker | ✓ | ✓ | — | — | ✓ | — | — | — |
| MessageActions | ✓ | — | — | — | — | — | — | — |
| ContextSourcePanel | ✓ | ✓ | ✓ | — | ✓ | — | — | — |
| MemoryInspector | ✓ | ✓ | ✓ | — | ✓ | — | — | — |
| DispatchInbox | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — |
| PermissionPrompt | ✓ | — | — | — | ✓ | ✓ | — | — |
| ProofViewer | ✓ | — | ✓ | — | ✓ | ✓ | — | — |
| StatusBar | ✓ | — | — | ✓ | — | — | ✓ | ✓ |
| PromptInput | ✓ | — | — | — | ✓ | — | — | — |
| CommandPalette (new) | ✓ | ✓ | — | — | — | — | — | — |

Total TUI cells: **~60**.

## State × Watch / CarPlay / Widgets / LiveActivity

### Watch

| View | Def | Empty | Loading | Disc |
|---|:-:|:-:|:-:|:-:|
| WatchHomeView | ✓ | ✓ | ✓ | ✓ |
| AgentTriageView | ✓ | ✓ | — | ✓ |
| TaskStatusView | ✓ | ✓ | ✓ | ✓ |
| QuickActionsView | ✓ | — | — | ✓ |
| CostView | ✓ | ✓ | ✓ | ✓ |

### CarPlay

| Template | Def | Empty | Loading |
|---|:-:|:-:|:-:|
| Chat tab | ✓ | ✓ | ✓ |
| Voice tab | ✓ | — | ✓ |
| Status tab | ✓ | — | ✓ |
| Conversation detail | ✓ | ✓ | ✓ |

### Widgets

| Widget | Small (2×2) | Medium (4×2) | Large (4×4) | Lock screen |
|---|:-:|:-:|:-:|:-:|
| AgentStatus | ✓ | ✓ | ✓ | ✓ |
| Cost | ✓ | ✓ | ✓ | ✓ |
| Workflow running (new) | ✓ | ✓ | ✓ | — |
| Cost preview (new) | ✓ | ✓ | — | ✓ |

### Live Activities

| Activity | Compact leading | Compact trailing | Expanded | Lock screen |
|---|:-:|:-:|:-:|:-:|
| TaskProgress | ✓ | ✓ | ✓ | ✓ |
| CostBudget (new) | ✓ | ✓ | ✓ | ✓ |
| MeetRecording (new) | ✓ | ✓ | ✓ | ✓ |

## Error state design rules

From `04-design-principles.md` Principle 4 — every error must name WHAT broke + give a next action.

### Standard error anatomy

```
┌──── Error ──────────────────────────────────────────────┐
│  <ICON>  <HEADLINE — what broke, in 1 clause>            │
│                                                          │
│  <BODY — 1-2 sentences, technical but honest>            │
│                                                          │
│  <ACTION PRIMARY>    <ACTION SECONDARY>                  │
└──────────────────────────────────────────────────────────┘
```

Examples (from session audits):

✓ **Good**: "Engine disconnected. Chat still works with cloud providers. [Reconnect] [Run diagnostics]"
✗ **Bad**: "Something went wrong. Try again." (generic, no next action)

✓ **Good**: "Anthropic rate limited. Next attempt in 24s. [Retry now] [Switch provider]"
✗ **Bad**: "Failed to send message." (no root cause, no action)

✓ **Good**: "OAuth token expired. [Re-authenticate] [Use API key instead]"
✗ **Bad**: "Authentication error." (vague)

## Loading state design rules

- Use **RuneForge** indicator (three-rune stroke-dash) for assistant streaming.
- Use **ValknutSpinner** for backend fetches, model loads, agent spawns (the existing signature spinner).
- Avoid the CSS default `animate-spin` — it appears in 40+ sites today and needs purging (audit tier-3 item 3.3).

## Empty state design rules

- Every empty state has a concrete CTA (not just "No data").
- CTAs never use exclamation marks.
- Empty states respect the theme (Valkyrie empty states are red-tinted, Bifrost are gradient).

Examples:

✓ "No conversations yet. [Start a new chat]"
✓ "No findings yet. Start an engagement to begin security research. [Set scope]"
✓ "No paired devices. [Scan QR] [Scan network]"

✗ "No data to show." (no action)
✗ "You haven't done anything yet!" (judgemental)

## Success state design rules

- Celebrate earned moments with the **Sealed Scroll**, not with toasts.
- Use **Sigil Stamp** for shadow-git checkpoints (subtle, non-intrusive).
- Full-screen celebrations (Bifrost theme) ONLY for: first task complete, first proof bundle sealed, major version upgrade.
- Never celebrate routine success (sending a message, opening a file).

## Disconnected state design rules

- Engine offline: amber banner with icon, not red.
- Copy: "Background engine paused — chat still works with cloud providers."
- Primary: `[Reconnect]`, secondary: `[Run diagnostics]`.
- Quick-action tiles remain enabled for cloud paths (Research, Compare models, Check costs).

## Offline / low-battery design rules (iOS)

- **Offline**: queue user prompts locally via `OfflineQueue.swift`; surface banner "Offline — 3 prompts queued for when connection returns."
- **Low-battery** (<20%): disable ProactiveCardDeck live fetches; throttle sync to 30-minute intervals; surface "Battery saver — full sync paused" chip.

---

*End of 11-states-inventory.*
