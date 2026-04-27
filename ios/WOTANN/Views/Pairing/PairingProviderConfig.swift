import SwiftUI

// MARK: - PairingProviderConfig
//
// V9 R-04 — Provider selection screen surfaced when the user chooses
// "Continue without pairing" from `PairingView`. Without a paired
// desktop the iOS app cannot rely on `providers.snapshot` to discover
// what's available, so we present a minimal hand-curated catalog of
// the 6 most common providers (Anthropic / OpenAI / Google / Groq /
// Ollama / OpenRouter) and let the user pick one. The selection is
// persisted to UserDefaults under `pendingProviderId` /
// `pendingProviderApiKey` so that whenever the user later pairs a
// desktop, the pairing handler can replay the selection through
// `RPCClient.saveProviderCredential` + `switchProvider`. This is the
// "no desktop" provisioning path described in V9 R-04.
//
// Design intent:
//   - Never call any RPC on this screen — `connectionManager.rpcClient`
//     is unauthenticated until pairing finishes.
//   - The API key field is `SecureField`, the UserDefaults write uses
//     a key prefixed `pendingProviderApiKey.<id>` so multiple providers
//     can be staged before pairing.
//   - "Skip for now" is a first-class affordance — the on-device model
//     is a valid fall-through when no key is supplied.
//
struct PairingProviderConfig: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("pendingProviderId") private var pendingProviderId: String = ""
    @State private var apiKey: String = ""
    @State private var selection: ProviderOption.ID = ProviderOption.catalog.first?.id ?? ""
    @State private var saved: Bool = false

    /// Optional callback fired after the user commits a selection. The
    /// host (PairingView) can use this to dismiss the wizard and route
    /// straight into `MainShell`.
    var onComplete: (() -> Void)?

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [
                        WTheme.Colors.background,
                        WTheme.Colors.primary.opacity(0.05),
                        WTheme.Colors.background,
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                VStack(spacing: WTheme.Spacing.lg) {
                    headerSection
                    providerListSection
                    apiKeyFieldSection
                    actionButtons

                    if saved {
                        Text("Saved. We'll send this to your desktop the moment you pair.")
                            .multilineTextAlignment(.center)
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.success)
                            .padding(.horizontal, WTheme.Spacing.xl)
                    }

                    Spacer()
                }
                .padding(.top, WTheme.Spacing.lg)
            }
            .navigationTitle("Choose Provider")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if !pendingProviderId.isEmpty,
                   ProviderOption.catalog.contains(where: { $0.id == pendingProviderId }) {
                    selection = pendingProviderId
                }
                // Restore any previously-staged key for the chosen provider.
                apiKey = readStagedKey(for: selection)
            }
            .onChange(of: selection) { _, newId in
                apiKey = readStagedKey(for: newId)
                saved = false
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: WTheme.Spacing.sm) {
            Image(systemName: "key.horizontal.fill")
                .font(.wotannScaled(size: 36, weight: .semibold))
                .foregroundColor(WTheme.Colors.primary)

            Text("Pick a Provider")
                .font(.wotannScaled(size: 22, weight: .bold, design: .rounded))
                .foregroundColor(WTheme.Colors.textPrimary)

            Text("No desktop? No problem. Choose how WOTANN should call models. We'll save this and apply it when you pair a Mac later.")
                .multilineTextAlignment(.center)
                .font(WTheme.Typography.caption)
                .foregroundColor(WTheme.Colors.textTertiary)
                .padding(.horizontal, WTheme.Spacing.xl)
        }
    }

    // MARK: - Provider List

    private var providerListSection: some View {
        VStack(spacing: WTheme.Spacing.xs) {
            ForEach(ProviderOption.catalog) { option in
                Button {
                    HapticService.shared.trigger(.buttonTap)
                    selection = option.id
                } label: {
                    HStack(spacing: WTheme.Spacing.sm) {
                        Image(systemName: option.icon)
                            .font(.title3)
                            .foregroundColor(option.tint)
                            .frame(width: 32)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(option.displayName)
                                .font(WTheme.Typography.subheadline)
                                .fontWeight(.medium)
                                .foregroundColor(WTheme.Colors.textPrimary)
                            Text(option.subtitle)
                                .font(WTheme.Typography.caption)
                                .foregroundColor(WTheme.Colors.textTertiary)
                                .lineLimit(1)
                        }

                        Spacer()

                        if selection == option.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(WTheme.Colors.primary)
                        }
                    }
                    .padding(WTheme.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(WTheme.Colors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                            .stroke(
                                selection == option.id
                                    ? WTheme.Colors.primary
                                    : WTheme.Colors.border,
                                lineWidth: selection == option.id
                                    ? WTheme.BorderWidth.thick
                                    : WTheme.BorderWidth.hairline
                            )
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(option.displayName) provider")
                .accessibilityHint(option.subtitle)
                .accessibilityAddTraits(selection == option.id ? .isSelected : [])
            }
        }
        .padding(.horizontal, WTheme.Spacing.xl)
    }

    // MARK: - API Key Field

    @ViewBuilder
    private var apiKeyFieldSection: some View {
        if let option = ProviderOption.catalog.first(where: { $0.id == selection }),
           option.requiresKey {
            VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                Text(option.keyLabel)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)

                SecureField(option.keyPlaceholder, text: $apiKey)
                    .textFieldStyle(.roundedBorder)
                    .font(WTheme.Typography.code)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onChange(of: apiKey) { _, _ in saved = false }
            }
            .padding(.horizontal, WTheme.Spacing.xl)
        }
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Button {
                HapticService.shared.trigger(.buttonTap)
                pendingProviderId = ""
                onComplete?()
                dismiss()
            } label: {
                Text("Skip for now")
                    .font(WTheme.Typography.headline)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .padding(.vertical, WTheme.Spacing.sm)
                    .background(WTheme.Colors.surface)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                    .overlay(
                        RoundedRectangle(cornerRadius: WTheme.Radius.md)
                            .stroke(WTheme.Colors.border, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)

            Button {
                HapticService.shared.trigger(.taskComplete)
                pendingProviderId = selection
                writeStagedKey(apiKey, for: selection)
                saved = true
                onComplete?()
                dismiss()
            } label: {
                Text("Save & Continue")
                    .font(WTheme.Typography.headline)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .padding(.vertical, WTheme.Spacing.sm)
                    .background(WTheme.Colors.primary)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
            }
            .buttonStyle(.plain)
            .disabled(needsKeyButMissing)
            .opacity(needsKeyButMissing ? 0.5 : 1.0)
        }
        .padding(.horizontal, WTheme.Spacing.xl)
    }

    // MARK: - Helpers

    /// True when the selected provider requires a key but the field is
    /// empty — disables the primary button so users can't stage an
    /// invalid configuration.
    private var needsKeyButMissing: Bool {
        guard let option = ProviderOption.catalog.first(where: { $0.id == selection }) else {
            return false
        }
        return option.requiresKey && apiKey.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// Per-provider UserDefaults key for the staged credential. Keeping
    /// keys separate (instead of one shared `pendingProviderApiKey`)
    /// lets the user switch providers without losing the previous
    /// entry, mirroring the desktop `ProviderService.saveCredential`
    /// per-provider semantics.
    private func stagedKey(for providerId: String) -> String {
        "pendingProviderApiKey.\(providerId)"
    }

    private func readStagedKey(for providerId: String) -> String {
        UserDefaults.standard.string(forKey: stagedKey(for: providerId)) ?? ""
    }

    private func writeStagedKey(_ value: String, for providerId: String) {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            UserDefaults.standard.removeObject(forKey: stagedKey(for: providerId))
        } else {
            UserDefaults.standard.set(trimmed, forKey: stagedKey(for: providerId))
        }
    }
}

// MARK: - ProviderOption

/// Hand-curated minimal provider catalog for the no-desktop path.
/// The desktop `providers.snapshot` flow is the source of truth once
/// pairing exists; this catalog only needs to cover the most common
/// onboarding paths so first-run is functional even offline.
private struct ProviderOption: Identifiable, Equatable {
    let id: String           // matches desktop `providerId`
    let displayName: String
    let subtitle: String
    let icon: String         // SF Symbol
    let tint: Color
    let requiresKey: Bool
    let keyLabel: String
    let keyPlaceholder: String

    static let catalog: [ProviderOption] = [
        ProviderOption(
            id: "anthropic",
            displayName: "Anthropic",
            subtitle: "Claude — Sonnet, Opus, Haiku",
            icon: "brain",
            tint: WTheme.Colors.provider("anthropic"),
            requiresKey: true,
            keyLabel: "Anthropic API Key",
            keyPlaceholder: "sk-ant-..."
        ),
        ProviderOption(
            id: "openai",
            displayName: "OpenAI",
            subtitle: "GPT-4, GPT-5, o-series",
            icon: "sparkles",
            tint: WTheme.Colors.provider("openai"),
            requiresKey: true,
            keyLabel: "OpenAI API Key",
            keyPlaceholder: "sk-..."
        ),
        // Gap-2 fix: id is "gemini" (matches daemon provider-service spec
        // and src/core/types.ts ProviderName union). Previously this was
        // "google" which the daemon rejected with "Unknown provider:
        // google" on saveCredential, leaving paired-iOS users unable to
        // use any Google model.
        ProviderOption(
            id: "gemini",
            displayName: "Google",
            subtitle: "Gemini 2.5, Flash",
            icon: "globe",
            tint: WTheme.Colors.provider("gemini"),
            requiresKey: true,
            keyLabel: "Google AI Key",
            keyPlaceholder: "AIza..."
        ),
        ProviderOption(
            id: "groq",
            displayName: "Groq",
            subtitle: "Fast Llama / Mixtral",
            icon: "bolt",
            tint: WTheme.Colors.provider("groq"),
            requiresKey: true,
            keyLabel: "Groq API Key",
            keyPlaceholder: "gsk_..."
        ),
        ProviderOption(
            id: "openrouter",
            displayName: "OpenRouter",
            subtitle: "Multi-provider routing",
            icon: "arrow.triangle.branch",
            tint: WTheme.Colors.provider("openrouter"),
            requiresKey: true,
            keyLabel: "OpenRouter Key",
            keyPlaceholder: "sk-or-..."
        ),
        ProviderOption(
            id: "ollama",
            displayName: "Ollama (on-device)",
            subtitle: "Local — no key needed",
            icon: "desktopcomputer",
            tint: WTheme.Colors.provider("ollama"),
            requiresKey: false,
            keyLabel: "",
            keyPlaceholder: ""
        ),
    ]
}

// MARK: - Preview

#Preview {
    PairingProviderConfig()
}
