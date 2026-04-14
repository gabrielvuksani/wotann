import SwiftUI

// MARK: - HealthInsightsSettingsView

/// Displays HealthKit-derived coding/wellness insights.
/// Accessed from the Health Insights section in SettingsView.
struct HealthInsightsSettingsView: View {
    @ObservedObject var healthKitService: HealthKitService

    var body: some View {
        List {
            authorizationSection

            if healthKitService.isAuthorized {
                insightsSection
            }

            if let error = healthKitService.error {
                errorSection(error)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(WTheme.Colors.background)
        .navigationTitle("Health Insights")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Authorization

    private var authorizationSection: some View {
        Section {
            if healthKitService.isAuthorized {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(WTheme.Colors.success)
                    Text("HealthKit Connected")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textPrimary)
                }
            } else {
                VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                    Text("WOTANN reads step count, sleep analysis, and active energy to correlate your health with coding sessions.")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textSecondary)

                    Button {
                        Task {
                            await healthKitService.requestAuthorization()
                            if healthKitService.isAuthorized {
                                await healthKitService.getInsights()
                            }
                        }
                    } label: {
                        HStack {
                            Spacer()
                            Image(systemName: "heart.fill")
                            Text("Connect HealthKit")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                        .foregroundColor(.white)
                        .padding(.vertical, WTheme.Spacing.sm)
                        .background(WTheme.Gradients.primary)
                        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                    }
                    .buttonStyle(.plain)
                }
            }
        } header: {
            Text("HealthKit Access")
                .font(.system(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        } footer: {
            Text("WOTANN only reads health data -- it never writes to HealthKit.")
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Insights

    private var insightsSection: some View {
        Section {
            if healthKitService.isLoading {
                HStack(spacing: WTheme.Spacing.sm) {
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Analyzing health data...")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            } else if healthKitService.insights.isEmpty {
                VStack(spacing: WTheme.Spacing.sm) {
                    Text("No insights yet")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textSecondary)

                    Button {
                        Task { await healthKitService.getInsights() }
                    } label: {
                        Label("Generate Insights", systemImage: "sparkles")
                            .font(WTheme.Typography.caption)
                    }
                }
                .padding(.vertical, WTheme.Spacing.sm)
            } else {
                ForEach(healthKitService.insights) { insight in
                    VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                        HStack(spacing: WTheme.Spacing.xs) {
                            Image(systemName: categoryIcon(insight.category))
                                .foregroundColor(categoryColor(insight.category))
                                .frame(width: WTheme.IconSize.md)
                            Text(insight.title)
                                .font(WTheme.Typography.subheadline)
                                .fontWeight(.medium)
                                .foregroundColor(WTheme.Colors.textPrimary)
                        }

                        Text(insight.detail)
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, WTheme.Spacing.xs)
                }

                Button {
                    Task { await healthKitService.getInsights() }
                } label: {
                    HStack {
                        Spacer()
                        Label("Refresh Insights", systemImage: "arrow.clockwise")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.primary)
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text("Insights (Last 14 Days)")
                .font(.system(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Error

    private func errorSection(_ message: String) -> some View {
        Section {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(WTheme.Colors.warning)
                Text(message)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.warning)
            }
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Helpers

    private func categoryIcon(_ category: HealthInsight.InsightCategory) -> String {
        switch category {
        case .sleep:    return "moon.zzz.fill"
        case .activity: return "flame.fill"
        case .steps:    return "figure.walk"
        case .general:  return "heart.fill"
        }
    }

    private func categoryColor(_ category: HealthInsight.InsightCategory) -> Color {
        switch category {
        case .sleep:    return WTheme.Colors.info
        case .activity: return WTheme.Colors.warning
        case .steps:    return WTheme.Colors.success
        case .general:  return WTheme.Colors.primary
        }
    }
}
