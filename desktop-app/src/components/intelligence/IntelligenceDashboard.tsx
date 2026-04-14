/**
 * Intelligence Dashboard — surfaces KAIROS Tier 1-4 subsystems.
 *
 * Layout: 2-column responsive grid of cards, each backed by a KAIROS
 * RPC endpoint via commands.sendMessage() with JSON-RPC format.
 *
 * Cards are split across IntelligenceCards.tsx, IntelligenceCardsSecondary.tsx,
 * and AdvancedCards.tsx to keep each file under 400 lines.
 */

import {
  HealthScoreCard,
  FlowActivityCard,
  DecisionLogCard,
  PWRPhaseCard,
  AmbientSignalsCard,
  TriggersCard,
} from "./IntelligenceCards";

import {
  DeviceContextCard,
  IdleStatusCard,
  SpecDivergenceCard,
  FileSearchCard,
} from "./IntelligenceCardsSecondary";

import {
  TaskRouterCard,
  MemoryQualityCard,
  BenchmarkCard,
  WakeUpContextCard,
} from "./AdvancedCards";

// ── Main Dashboard ────────────────────────────────────

export function IntelligenceDashboard() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="border-b animate-fadeIn"
        style={{
          borderColor: "var(--border-subtle)",
          padding: "var(--space-md)",
        }}
      >
        <h2
          style={{
            fontSize: "var(--font-size-lg)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            marginBottom: "var(--space-xs)",
          }}
        >
          Intelligence
        </h2>
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
          Tier 1-4 subsystems — health, flow, decisions, routing, memory, and benchmarks
        </p>
      </div>

      {/* Card grid */}
      <div
        className="flex-1 overflow-y-auto"
        style={{
          padding: "var(--space-md)",
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12,
          alignContent: "start",
        }}
      >
        <HealthScoreCard />
        <FlowActivityCard />
        <DecisionLogCard />
        <PWRPhaseCard />
        <AmbientSignalsCard />
        <TriggersCard />
        <DeviceContextCard />
        <IdleStatusCard />
        <SpecDivergenceCard />
        <FileSearchCard />
        <TaskRouterCard />
        <MemoryQualityCard />
        <BenchmarkCard />
        <WakeUpContextCard />
      </div>
    </div>
  );
}
