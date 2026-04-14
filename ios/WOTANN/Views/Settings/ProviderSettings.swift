import SwiftUI

// MARK: - ProviderSettings

/// View active providers and their status. The list is sourced from the
/// desktop WOTANN instance via `providers.list` — there is no hardcoded
/// catalog on iOS, so whatever the desktop exposes is what the user sees.
struct ProviderSettings: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        List {
            Section {
                Text("Providers are configured on your desktop WOTANN instance. This view shows which providers are currently active.")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            .listRowBackground(Color.clear)

            if appState.availableProviders.isEmpty {
                Section("Available Providers") {
                    VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                        Text("No providers detected")
                            .font(WTheme.Typography.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Text("Configure providers on your desktop. They'll appear here automatically once the iOS app syncs.")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                    .padding(.vertical, WTheme.Spacing.xs)
                    .listRowBackground(WTheme.Colors.surface)
                }
            } else {
                Section("Available Providers") {
                    ForEach(appState.availableProviders) { provider in
                        ProviderRow(provider: provider, currentProvider: appState.currentProvider)
                    }
                    .listRowBackground(WTheme.Colors.surface)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(WTheme.Colors.background)
        .navigationTitle("Providers")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - ProviderRow

private struct ProviderRow: View {
    let provider: ProviderInfo
    let currentProvider: String

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Image(systemName: iconName(for: provider.name))
                .font(.title3)
                .foregroundColor(WTheme.Colors.provider(provider.name))
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(provider.name)
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text(subtitle(for: provider))
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }

            Spacer()

            if currentProvider.lowercased() == provider.id.lowercased()
                || currentProvider.lowercased() == provider.name.lowercased() {
                Text("Active")
                    .font(WTheme.Typography.caption2)
                    .fontWeight(.medium)
                    .foregroundColor(WTheme.Colors.success)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(WTheme.Colors.success.opacity(0.15))
                    .clipShape(Capsule())
            } else if !provider.isConfigured {
                Text("Not configured")
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(WTheme.Colors.textTertiary.opacity(0.12))
                    .clipShape(Capsule())
            }
        }
    }

    private func subtitle(for provider: ProviderInfo) -> String {
        if let defaultModel = provider.defaultModel, !defaultModel.isEmpty {
            return defaultModel
        }
        if !provider.models.isEmpty {
            return "\(provider.models.count) model\(provider.models.count == 1 ? "" : "s")"
        }
        return provider.id
    }

    private func iconName(for providerName: String) -> String {
        switch providerName.lowercased() {
        case "anthropic": return "brain"
        case "openai": return "sparkles"
        case "google", "gemini": return "globe"
        case "groq": return "bolt"
        case "ollama": return "desktopcomputer"
        case "deepseek": return "magnifyingglass"
        case "mistral": return "wind"
        case "openrouter": return "arrow.triangle.branch"
        case "xai", "grok": return "xmark.circle"
        case "cohere": return "circle.grid.3x3"
        case "together": return "person.2"
        default: return "circle.hexagongrid"
        }
    }
}
