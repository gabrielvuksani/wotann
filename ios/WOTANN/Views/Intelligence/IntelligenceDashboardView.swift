import SwiftUI

// MARK: - IntelligenceDashboardView

/// Intelligence Dashboard -- surfaces WOTANN's 10 Tier 1 intelligence features
/// in a single scrollable view: health, flow, decisions, PWR, ambient, triggers, and devices.
struct IntelligenceDashboardView: View {
    @EnvironmentObject var connectionManager: ConnectionManager

    @State private var isLoading = true
    @State private var errorMessage: String?

    // Data state
    @State private var healthScore: Int = 0
    @State private var healthLabel: String = ""
    @State private var flowActions: [[String: RPCValue]] = []
    @State private var flowVelocity: Double = 0
    @State private var decisions: [[String: RPCValue]] = []
    @State private var pwrPhase: String = "idle"
    @State private var pwrProgress: Double = 0
    @State private var ambientSignalCount: Int = 0
    @State private var ambientLatestSuggestion: String = ""
    @State private var triggerCount: Int = 0
    @State private var devices: [[String: RPCValue]] = []

    var body: some View {
        NavigationStack {
            ScrollView {
                if isLoading {
                    loadingState
                } else if let error = errorMessage {
                    errorState(error)
                } else {
                    dashboardContent
                }
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Intelligence")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await loadAll() }
        }
        .task { await loadAll() }
    }
}

// MARK: - Loading & Error States

private extension IntelligenceDashboardView {

    var loadingState: some View {
        VStack(spacing: WTheme.Spacing.lg) {
            Spacer(minLength: 120)
            ProgressView()
                .tint(WTheme.Colors.primary)
                .scaleEffect(1.2)
            Text("Loading intelligence data...")
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textTertiary)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    func errorState(_ message: String) -> some View {
        VStack(spacing: WTheme.Spacing.md) {
            Spacer(minLength: 100)
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundColor(WTheme.Colors.warning)
            Text("Could not load data")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)
            Text(message)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textTertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, WTheme.Spacing.xl)
            Button {
                Task { await loadAll() }
            } label: {
                Text("Retry")
                    .font(WTheme.Typography.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, WTheme.Spacing.xl)
                    .padding(.vertical, WTheme.Spacing.sm)
                    .background(WTheme.Colors.primary)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Dashboard Content

private extension IntelligenceDashboardView {

    var dashboardContent: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.lg) {
            healthScoreSection
            flowActivitySection
            decisionsSection
            pwrPhaseSection
            ambientSignalsSection
            triggersSection
            deviceContextSection
        }
        .padding(WTheme.Spacing.lg)
    }
}

// MARK: - Health Score

private extension IntelligenceDashboardView {

    var healthScoreSection: some View {
        SectionCard(title: "Health Score", icon: "heart.text.clipboard") {
            HStack(spacing: WTheme.Spacing.lg) {
                HealthGauge(score: healthScore)
                    .frame(width: 80, height: 80)

                VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                    Text(healthScoreLabel)
                        .font(.system(size: 18, weight: .bold))
                        .tracking(WTheme.Tracking.tighter)
                        .foregroundColor(healthScoreColor)

                    if !healthLabel.isEmpty {
                        Text(healthLabel)
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .lineLimit(2)
                    }
                }

                Spacer()
            }
        }
    }

    var healthScoreLabel: String {
        if healthScore >= 70 { return "Healthy" }
        if healthScore >= 40 { return "Attention Needed" }
        return "Critical"
    }

    var healthScoreColor: Color {
        if healthScore >= 70 { return WTheme.Colors.success }
        if healthScore >= 40 { return WTheme.Colors.warning }
        return WTheme.Colors.error
    }
}

// MARK: - Flow Activity

private extension IntelligenceDashboardView {

    var flowActivitySection: some View {
        SectionCard(title: "Flow Activity", icon: "chart.bar.fill") {
            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                // Velocity indicator
                HStack(spacing: WTheme.Spacing.xs) {
                    Image(systemName: "gauge.with.dots.needle.33percent")
                        .font(.system(size: 12))
                        .foregroundColor(WTheme.Colors.primary)
                    Text("Velocity: \(String(format: "%.1f", flowVelocity)) actions/hr")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textSecondary)
                }

                if flowActions.isEmpty {
                    Text("No recent actions tracked")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .padding(.vertical, WTheme.Spacing.sm)
                } else {
                    ForEach(Array(flowActions.prefix(5).enumerated()), id: \.offset) { _, action in
                        FlowActionRow(action: action)
                    }
                }
            }
        }
    }
}

// MARK: - Decisions

private extension IntelligenceDashboardView {

    var decisionsSection: some View {
        SectionCard(title: "Decisions", icon: "brain") {
            if decisions.isEmpty {
                Text("No decisions recorded yet")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .padding(.vertical, WTheme.Spacing.sm)
            } else {
                ForEach(Array(decisions.prefix(5).enumerated()), id: \.offset) { _, decision in
                    DecisionRow(decision: decision)
                }
            }
        }
    }
}

// MARK: - PWR Phase

private extension IntelligenceDashboardView {

    var pwrPhaseSection: some View {
        SectionCard(title: "PWR Phase", icon: "arrow.triangle.branch") {
            VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
                // Phase badge
                HStack(spacing: WTheme.Spacing.sm) {
                    Text(pwrPhase.uppercased())
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(.white)
                        .padding(.horizontal, WTheme.Spacing.sm)
                        .padding(.vertical, WTheme.Spacing.xs)
                        .background(pwrPhaseColor)
                        .clipShape(Capsule())

                    Spacer()

                    Text("\(Int(pwrProgress * 100))%")
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textSecondary)
                }

                // Progress bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.white.opacity(0.08))
                            .frame(height: 6)

                        RoundedRectangle(cornerRadius: 4)
                            .fill(pwrPhaseColor)
                            .frame(width: geo.size.width * pwrProgress, height: 6)
                    }
                }
                .frame(height: 6)

                // Phase labels row
                HStack {
                    ForEach(pwrPhases, id: \.self) { phase in
                        Text(phase.prefix(3).uppercased())
                            .font(.system(size: 8, weight: .medium, design: .monospaced))
                            .foregroundColor(
                                phase == pwrPhase
                                    ? WTheme.Colors.textPrimary
                                    : WTheme.Colors.textTertiary
                            )
                        if phase != pwrPhases.last {
                            Spacer()
                        }
                    }
                }
            }
        }
    }

    var pwrPhases: [String] {
        ["discuss", "plan", "implement", "review", "uat", "ship"]
    }

    var pwrPhaseColor: Color {
        switch pwrPhase {
        case "discuss":   return WTheme.Colors.info
        case "plan":      return WTheme.Colors.warning
        case "implement": return WTheme.Colors.primary
        case "review":    return .wotannCyan
        case "uat":       return WTheme.Colors.chartAccent
        case "ship":      return WTheme.Colors.success
        default:          return WTheme.Colors.textTertiary
        }
    }
}

// MARK: - Ambient Signals

private extension IntelligenceDashboardView {

    var ambientSignalsSection: some View {
        SectionCard(title: "Ambient Signals", icon: "waveform.circle") {
            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                HStack(spacing: WTheme.Spacing.lg) {
                    SignalBadge(
                        icon: "doc.on.clipboard",
                        label: "Clipboard",
                        isActive: ambientSignalCount > 0
                    )
                    SignalBadge(
                        icon: "doc.fill",
                        label: "Files",
                        isActive: ambientSignalCount > 0
                    )
                    SignalBadge(
                        icon: "terminal.fill",
                        label: "Terminal",
                        isActive: ambientSignalCount > 0
                    )
                    Spacer()
                    Text("\(ambientSignalCount)")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(WTheme.Colors.textPrimary)
                    Text("signals")
                        .font(.system(size: 11))
                        .foregroundColor(WTheme.Colors.textTertiary)
                }

                if !ambientLatestSuggestion.isEmpty {
                    HStack(spacing: WTheme.Spacing.xs) {
                        Image(systemName: "lightbulb.fill")
                            .font(.system(size: 10))
                            .foregroundColor(WTheme.Colors.warning)
                        Text(ambientLatestSuggestion)
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .lineLimit(2)
                    }
                    .padding(WTheme.Spacing.sm)
                    .background(WTheme.Colors.warning.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                }
            }
        }
    }
}

// MARK: - Triggers

private extension IntelligenceDashboardView {

    var triggersSection: some View {
        SectionCard(title: "Triggers", icon: "bolt.fill") {
            HStack(spacing: WTheme.Spacing.sm) {
                Text("\(triggerCount)")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(WTheme.Colors.textPrimary)

                VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                    Text("active triggers")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textSecondary)
                    Text("Monitoring events and conditions")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }

                Spacer()

                Image(systemName: triggerCount > 0 ? "bolt.circle.fill" : "bolt.slash.circle")
                    .font(.system(size: 24))
                    .foregroundColor(
                        triggerCount > 0
                            ? WTheme.Colors.primary
                            : WTheme.Colors.textTertiary
                    )
            }
        }
    }
}

// MARK: - Device Context

private extension IntelligenceDashboardView {

    var deviceContextSection: some View {
        SectionCard(title: "Device Context", icon: "laptopcomputer.and.iphone") {
            if devices.isEmpty {
                HStack(spacing: WTheme.Spacing.sm) {
                    DeviceDot(icon: "desktopcomputer", label: "Desktop", isConnected: false)
                    DeviceDot(icon: "iphone", label: "Phone", isConnected: true)
                    DeviceDot(icon: "applewatch", label: "Watch", isConnected: false)
                    Spacer()
                }
            } else {
                HStack(spacing: WTheme.Spacing.sm) {
                    ForEach(Array(devices.enumerated()), id: \.offset) { _, device in
                        let name = device["name"]?.stringValue ?? "Unknown"
                        let kind = device["type"]?.stringValue ?? "desktop"
                        let connected = device["connected"]?.boolValue ?? false
                        DeviceDot(
                            icon: deviceIcon(for: kind),
                            label: name,
                            isConnected: connected
                        )
                    }
                    Spacer()
                }
            }
        }
    }

    func deviceIcon(for type: String) -> String {
        switch type.lowercased() {
        case "desktop", "mac":   return "desktopcomputer"
        case "phone", "iphone":  return "iphone"
        case "watch":            return "applewatch"
        case "tablet", "ipad":   return "ipad"
        default:                 return "laptopcomputer"
        }
    }
}

// MARK: - Data Loading

private extension IntelligenceDashboardView {

    @MainActor
    func loadAll() async {
        guard connectionManager.isPaired else {
            errorMessage = "Not connected to desktop"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil
        let rpc = connectionManager.rpcClient

        do {
            async let healthData = rpc.getHealthReport()
            async let flowData = rpc.getFlowInsights()
            async let decisionData = rpc.listDecisions()
            async let pwrData = rpc.getPWRStatus()
            async let ambientData = rpc.getAmbientStatus()
            async let triggerData = rpc.listTriggers()
            async let deviceData = rpc.getCrossDeviceContext()

            let health = try await healthData
            let flow = try await flowData
            let decisionResult = try await decisionData
            let pwr = try await pwrData
            let ambient = try await ambientData
            let triggers = try await triggerData
            let deviceCtx = try await deviceData

            // Parse health
            healthScore = health["score"]?.intValue
                ?? Int(health["score"]?.doubleValue ?? 0)
            healthLabel = health["summary"]?.stringValue
                ?? health["label"]?.stringValue
                ?? ""

            // Parse flow
            flowActions = (flow["actions"]?.arrayValue ?? [])
                .compactMap { $0.objectValue }
            flowVelocity = flow["velocity"]?.doubleValue ?? 0

            // Parse decisions
            decisions = (decisionResult["decisions"]?.arrayValue ?? [])
                .compactMap { $0.objectValue }

            // Parse PWR
            pwrPhase = pwr["phase"]?.stringValue ?? "idle"
            pwrProgress = pwr["progress"]?.doubleValue ?? 0

            // Parse ambient
            ambientSignalCount = ambient["count"]?.intValue
                ?? Int(ambient["count"]?.doubleValue ?? 0)
            ambientLatestSuggestion = ambient["latestSuggestion"]?.stringValue
                ?? ambient["suggestion"]?.stringValue
                ?? ""

            // Parse triggers
            triggerCount = triggers["count"]?.intValue
                ?? (triggers["triggers"]?.arrayValue?.count ?? 0)

            // Parse devices
            devices = (deviceCtx["devices"]?.arrayValue ?? [])
                .compactMap { $0.objectValue }

            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
}

// MARK: - SectionCard

/// Reusable card container matching WOTANN's dark surface style.
private struct SectionCard<Content: View>: View {
    let title: String
    let icon: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
            HStack(spacing: WTheme.Spacing.xs) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .foregroundColor(WTheme.Colors.primary)
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .tracking(1.2)
            }

            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .shadow(
            color: WTheme.Shadow.sm.color,
            radius: WTheme.Shadow.sm.radius,
            x: WTheme.Shadow.sm.x,
            y: WTheme.Shadow.sm.y
        )
    }
}

// MARK: - HealthGauge

/// Circular gauge showing a 0-100 health score with color coding.
private struct HealthGauge: View {
    let score: Int

    private var normalized: Double {
        min(max(Double(score) / 100.0, 0), 1)
    }

    private var gaugeColor: Color {
        if score >= 70 { return WTheme.Colors.success }
        if score >= 40 { return WTheme.Colors.warning }
        return WTheme.Colors.error
    }

    var body: some View {
        ZStack {
            // Background ring
            Circle()
                .stroke(Color.white.opacity(0.06), lineWidth: 6)

            // Filled arc
            Circle()
                .trim(from: 0, to: normalized)
                .stroke(
                    gaugeColor,
                    style: StrokeStyle(lineWidth: 6, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .shadow(color: gaugeColor.opacity(0.4), radius: 4, x: 0, y: 0)

            // Score text
            VStack(spacing: 0) {
                Text("\(score)")
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundColor(gaugeColor)
                Text("/ 100")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
    }
}

// MARK: - FlowActionRow

/// A single row representing a tracked FlowTracker action.
private struct FlowActionRow: View {
    let action: [String: RPCValue]

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Circle()
                .fill(WTheme.Colors.primary.opacity(0.3))
                .frame(width: 6, height: 6)

            Text(action["type"]?.stringValue ?? action["action"]?.stringValue ?? "Action")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(1)

            Spacer()

            if let ts = action["timestamp"]?.stringValue {
                Text(ts.suffix(8))
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
        .padding(.vertical, WTheme.Spacing.xxs)
    }
}

// MARK: - DecisionRow

/// A single decision with title and rationale preview.
private struct DecisionRow: View {
    let decision: [String: RPCValue]

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
            Text(decision["title"]?.stringValue ?? decision["summary"]?.stringValue ?? "Decision")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(1)

            if let rationale = decision["rationale"]?.stringValue ?? decision["reason"]?.stringValue {
                Text(rationale)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, WTheme.Spacing.xxs)
    }
}

// MARK: - SignalBadge

/// A small icon + label badge indicating a signal source type.
private struct SignalBadge: View {
    let icon: String
    let label: String
    let isActive: Bool

    var body: some View {
        VStack(spacing: WTheme.Spacing.xxs) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(isActive ? WTheme.Colors.primary : WTheme.Colors.textTertiary)
            Text(label)
                .font(.system(size: 8, weight: .medium))
                .foregroundColor(WTheme.Colors.textTertiary)
        }
    }
}

// MARK: - DeviceDot

/// Indicator for a connected device: icon, name, and status dot.
private struct DeviceDot: View {
    let icon: String
    let label: String
    let isConnected: Bool

    var body: some View {
        VStack(spacing: WTheme.Spacing.xs) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(
                        isConnected
                            ? WTheme.Colors.textPrimary
                            : WTheme.Colors.textTertiary
                    )
                    .frame(width: 40, height: 40)
                    .background(
                        isConnected
                            ? WTheme.Colors.primary.opacity(0.1)
                            : Color.white.opacity(0.04)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))

                Circle()
                    .fill(isConnected ? WTheme.Colors.success : WTheme.Colors.textTertiary)
                    .frame(width: 8, height: 8)
                    .shadow(
                        color: isConnected ? WTheme.Colors.success.opacity(0.5) : .clear,
                        radius: isConnected ? 3 : 0,
                        x: 0,
                        y: 0
                    )
                    .offset(x: 2, y: -2)
            }

            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(WTheme.Colors.textTertiary)
                .lineLimit(1)
        }
    }
}

// MARK: - Previews

#Preview("Intelligence Dashboard") {
    IntelligenceDashboardView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
