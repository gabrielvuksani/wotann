import SwiftUI

// MARK: - MorningBriefingView

/// Card shown at the top of ConversationListView on first daily connect.
/// Displays overnight CI status, PRs merged, issues assigned, yesterday's cost,
/// and agents completed. Data comes from the desktop via "briefing.daily" RPC.
struct MorningBriefingView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @AppStorage("lastBriefingDate") private var lastBriefingDate = ""
    @State private var briefing: DailyBriefing?
    @State private var isLoading = true
    @State private var isDismissed = false

    var body: some View {
        Group {
            if !isDismissed, let briefing {
                briefingCard(briefing)
                    .transition(.asymmetric(
                        insertion: .move(edge: .top).combined(with: .opacity),
                        removal: .opacity
                    ))
            } else if !isDismissed && isLoading {
                loadingCard
            }
        }
        .task {
            await loadBriefing()
        }
    }

    // MARK: - Briefing Card

    private func briefingCard(_ data: DailyBriefing) -> some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
            header

            Divider()
                .background(WTheme.Colors.border)

            statsGrid(data)

            if !data.highlights.isEmpty {
                highlightsSection(data.highlights)
            }

            dismissButton
        }
        .padding(WTheme.Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: WTheme.Radius.lg)
                .fill(WTheme.Colors.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: WTheme.Radius.lg)
                        .stroke(
                            LinearGradient(
                                colors: [WTheme.Colors.primary.opacity(0.4), .clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
        )
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.top, WTheme.Spacing.sm)
    }

    private var header: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Image(systemName: "sunrise.fill")
                .font(.title3)
                .foregroundStyle(
                    LinearGradient(
                        colors: [WTheme.Colors.warning, WTheme.Colors.primary],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            VStack(alignment: .leading, spacing: 2) {
                Text("Good Morning")
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text("Here's what happened overnight")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }

            Spacer()

            Text(todayFormatted)
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
    }

    // MARK: - Stats Grid

    private func statsGrid(_ data: DailyBriefing) -> some View {
        LazyVGrid(
            columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
            spacing: WTheme.Spacing.sm
        ) {
            statCell(
                icon: "checkmark.circle.fill",
                value: "\(data.ciStatus.passed)/\(data.ciStatus.total)",
                label: "CI Passed",
                color: data.ciStatus.allPassed ? WTheme.Colors.success : WTheme.Colors.warning
            )

            statCell(
                icon: "arrow.triangle.merge",
                value: "\(data.prsMerged)",
                label: "PRs Merged",
                color: WTheme.Colors.primary
            )

            statCell(
                icon: "exclamationmark.circle.fill",
                value: "\(data.issuesAssigned)",
                label: "Issues",
                color: data.issuesAssigned > 0 ? WTheme.Colors.error : WTheme.Colors.textTertiary
            )

            statCell(
                icon: "dollarsign.circle.fill",
                value: String(format: "$%.2f", data.yesterdayCost),
                label: "Yesterday",
                color: WTheme.Colors.warning
            )

            statCell(
                icon: "gearshape.2.fill",
                value: "\(data.agentsCompleted)",
                label: "Agents Done",
                color: WTheme.Colors.success
            )

            statCell(
                icon: "clock.fill",
                value: formattedUptime(data.uptimeHours),
                label: "Uptime",
                color: WTheme.Colors.textSecondary
            )
        }
    }

    private func statCell(icon: String, value: String, label: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(color)

            Text(value)
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            Text(label)
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, WTheme.Spacing.xs)
    }

    // MARK: - Highlights

    private func highlightsSection(_ highlights: [String]) -> some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            Text("Highlights")
                .font(WTheme.Typography.caption)
                .fontWeight(.semibold)
                .foregroundColor(WTheme.Colors.textSecondary)

            ForEach(Array(highlights.prefix(3).enumerated()), id: \.offset) { _, highlight in
                HStack(alignment: .top, spacing: WTheme.Spacing.xs) {
                    Circle()
                        .fill(WTheme.Colors.primary)
                        .frame(width: 5, height: 5)
                        .padding(.top, 6)

                    Text(highlight)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .lineLimit(2)
                }
            }
        }
    }

    // MARK: - Dismiss Button

    private var dismissButton: some View {
        Button {
            withAnimation(WTheme.Animation.smooth) {
                isDismissed = true
                lastBriefingDate = todayString
            }
            HapticService.shared.trigger(.buttonTap)
        } label: {
            Text("Got it")
                .font(WTheme.Typography.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, WTheme.Spacing.sm)
                .background(WTheme.Colors.primary)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
        }
    }

    // MARK: - Loading

    private var loadingCard: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            ProgressView()
                .tint(WTheme.Colors.primary)
            Text("Loading briefing...")
                .font(WTheme.Typography.caption)
                .foregroundColor(WTheme.Colors.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg))
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.top, WTheme.Spacing.sm)
    }

    // MARK: - Data Loading

    private func loadBriefing() async {
        defer { isLoading = false }

        do {
            let response = try await connectionManager.rpcClient.send("briefing.daily")
            guard let obj = response.result?.objectValue else { return }

            let ciPassed = rpcInt(obj["ciPassed"])
            let ciTotal = rpcInt(obj["ciTotal"])
            let prsMerged = rpcInt(obj["prsMerged"])
            let issuesAssigned = rpcInt(obj["issuesAssigned"])
            let yesterdayCost = rpcDouble(obj["yesterdayCost"])
            let agentsCompleted = rpcInt(obj["agentsCompleted"])
            let uptimeHours = rpcDouble(obj["uptimeHours"])
            let highlights = obj["highlights"]?.arrayValue?.compactMap(\.stringValue) ?? []

            let result = DailyBriefing(
                ciStatus: CIStatus(passed: ciPassed, total: ciTotal),
                prsMerged: prsMerged,
                issuesAssigned: issuesAssigned,
                yesterdayCost: yesterdayCost,
                agentsCompleted: agentsCompleted,
                uptimeHours: uptimeHours,
                highlights: highlights
            )
            briefing = result

            // S5-11: surface the briefing on the Lock Screen so the user can
            // glance at CI status without launching the app. One activity per
            // day — keyed on `todayString` — so we don't flood the stack when
            // the view re-mounts on tab switches.
            presentBriefingLiveActivity(briefing: result)
        } catch {
            // Briefing unavailable -- silently hide the card
            briefing = nil
        }
    }

    /// Raise a Lock Screen / Dynamic Island presentation of the briefing
    /// summary. Guarded on a once-per-day user-default flag so repeat mounts
    /// (tab switches, scene re-foreground) do not repeatedly re-launch the
    /// same activity.
    private func presentBriefingLiveActivity(briefing: DailyBriefing) {
        let key = "liveActivity.briefingPresented.\(todayString)"
        if UserDefaults.standard.bool(forKey: key) { return }

        let summary = "\(briefing.ciStatus.passed)/\(briefing.ciStatus.total) CI · "
            + "\(briefing.prsMerged) PRs · "
            + "\(briefing.agentsCompleted) agents"

        LiveActivityManager.shared.startBriefing(
            id: UUID(),
            summary: summary,
            cost: briefing.yesterdayCost
        )
        UserDefaults.standard.set(true, forKey: key)
    }

    /// Extract an Int from an RPCValue that may be `.int` or `.double`.
    private func rpcInt(_ value: RPCValue?) -> Int {
        guard let value else { return 0 }
        if let i = value.intValue { return i }
        if let d = value.doubleValue { return Int(d) }
        return 0
    }

    /// Extract a Double from an RPCValue that may be `.double` or `.int`.
    private func rpcDouble(_ value: RPCValue?) -> Double {
        guard let value else { return 0 }
        if let d = value.doubleValue { return d }
        if let i = value.intValue { return Double(i) }
        return 0
    }

    // MARK: - Helpers

    private var todayString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private var todayFormatted: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter.string(from: Date())
    }

    private func formattedUptime(_ hours: Double) -> String {
        if hours >= 24 {
            return String(format: "%.0fd", hours / 24)
        }
        return String(format: "%.0fh", hours)
    }
}

// MARK: - Models

struct DailyBriefing {
    let ciStatus: CIStatus
    let prsMerged: Int
    let issuesAssigned: Int
    let yesterdayCost: Double
    let agentsCompleted: Int
    let uptimeHours: Double
    let highlights: [String]
}

struct CIStatus {
    let passed: Int
    let total: Int

    var allPassed: Bool { passed == total && total > 0 }
}

