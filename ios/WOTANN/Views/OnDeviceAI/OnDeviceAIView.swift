import SwiftUI

// MARK: - OnDeviceAIView

/// Manage on-device AI models for offline chat capability.
struct OnDeviceAIView: View {
    // S4-25: read the process-wide singleton rather than instantiating a fresh
    // service per-view. The preview path injects a local instance for isolated
    // rendering.
    @EnvironmentObject private var modelService: OnDeviceModelService
    @AppStorage("enableOnDeviceInference") private var enableOnDevice = false

    var body: some View {
        List {
            infoSection
            toggleSection
            modelStatusSection
            if enableOnDevice { downloadSection }
            storageSection
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(WTheme.Colors.background)
        .navigationTitle("On-Device AI")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Sections

    private var infoSection: some View {
        Section {
            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "cpu.fill")
                        .font(.wotannScaled(size: 24))
                        .foregroundStyle(WTheme.Gradients.primary)
                    Text("Local AI Inference")
                        .font(WTheme.Typography.title3)
                        .foregroundColor(WTheme.Colors.textPrimary)
                }

                Text("When your desktop is unreachable, WOTANN can run AI models directly on your iPhone. Responses are processed locally — no data leaves your device.")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
        }
        .listRowBackground(Color.clear)
    }

    private var toggleSection: some View {
        Section {
            Toggle(isOn: $enableOnDevice) {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "bolt.circle.fill")
                        .foregroundColor(WTheme.Colors.primary)
                        .frame(width: WTheme.IconSize.md)
                    VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                        Text("Enable On-Device AI")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Text("Use local models when desktop is offline")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                }
            }
            .tint(WTheme.Colors.primary)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var modelStatusSection: some View {
        Section {
            HStack {
                Text("Device Compatible")
                Spacer()
                Text(modelService.canRunOnDevice ? "Yes" : "No")
                    .foregroundColor(modelService.canRunOnDevice ? WTheme.Colors.success : WTheme.Colors.error)
            }

            HStack {
                Text("RAM Required")
                Spacer()
                Text("~2.5 GB")
                    .font(WTheme.Typography.code)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }

            HStack {
                Text("Model Downloaded")
                Spacer()
                if modelService.isModelDownloaded {
                    Label("Ready", systemImage: "checkmark.circle.fill")
                        .foregroundColor(WTheme.Colors.success)
                        .font(WTheme.Typography.caption)
                } else {
                    Text("Not downloaded")
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .font(WTheme.Typography.caption)
                }
            }

            #if canImport(FoundationModels)
            HStack {
                Text("Apple Foundation Models")
                Spacer()
                if #available(iOS 26, *) {
                    Label("Available", systemImage: "checkmark.circle.fill")
                        .foregroundColor(WTheme.Colors.success)
                        .font(WTheme.Typography.caption)
                } else {
                    Text("Requires iOS 26+")
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .font(WTheme.Typography.caption)
                }
            }
            #endif
        } header: {
            Text("Model Status")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var downloadSection: some View {
        Section {
            if modelService.isDownloading {
                VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                    HStack {
                        Text("Downloading Gemma 4 E2B...")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Spacer()
                        Text("\(Int(modelService.downloadProgress * 100))%")
                            .font(WTheme.Typography.caption)
                            .fontDesign(.monospaced)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                    ProgressView(value: modelService.downloadProgress)
                        .tint(WTheme.Colors.primary)
                }
            } else if modelService.isModelDownloaded {
                Button(role: .destructive) {
                    try? modelService.deleteModel()
                } label: {
                    Label("Delete Downloaded Model", systemImage: "trash")
                        .foregroundColor(WTheme.Colors.error)
                }
            } else {
                Button {
                    Task { try? await modelService.downloadModel() }
                } label: {
                    HStack {
                        Image(systemName: "arrow.down.circle.fill")
                            .foregroundColor(WTheme.Colors.primary)
                        VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                            Text("Download Gemma 4 E2B")
                                .font(WTheme.Typography.subheadline)
                                .foregroundColor(WTheme.Colors.textPrimary)
                            Text("~\(modelService.storageEstimate) • Full offline conversations")
                                .font(WTheme.Typography.caption)
                                .foregroundColor(WTheme.Colors.textTertiary)
                        }
                    }
                }
                .disabled(!modelService.canRunOnDevice)
            }

            if let error = modelService.lastError {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(WTheme.Colors.warning)
                    Text(error)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.warning)
                }
            }
        } header: {
            Text("Model Download")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var storageSection: some View {
        Section {
            VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                Text("Inference Tiers (when offline)")
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(WTheme.Colors.textPrimary)

                TierRow(number: 1, name: "Apple Intelligence", detail: "Free, instant, simple tasks", available: true)
                TierRow(number: 2, name: "Gemma 4 E2B (MLX)", detail: "~2GB download, full conversations", available: modelService.isModelDownloaded)
                TierRow(number: 3, name: "Offline Queue", detail: "Delivers when desktop reconnects", available: true)
            }
        } header: {
            Text("How It Works")
        }
        .listRowBackground(WTheme.Colors.surface)
    }
}

// MARK: - TierRow

private struct TierRow: View {
    let number: Int
    let name: String
    let detail: String
    let available: Bool

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Text("\(number)")
                .font(.wotannScaled(size: 11, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
                .frame(width: 20, height: 20)
                .background(available ? WTheme.Colors.primary : WTheme.Colors.textTertiary)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(WTheme.Typography.caption)
                    .fontWeight(.medium)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text(detail)
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }

            Spacer()

            Image(systemName: available ? "checkmark.circle.fill" : "circle.dashed")
                .font(.caption)
                .foregroundColor(available ? WTheme.Colors.success : WTheme.Colors.textTertiary)
        }
        .padding(.vertical, WTheme.Spacing.xxs)
    }
}

#Preview {
    NavigationStack {
        OnDeviceAIView()
            .environmentObject(OnDeviceModelService())
    }
    .preferredColorScheme(.dark)
}
