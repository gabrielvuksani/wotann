import SwiftUI

// MARK: - AppearanceSettings

/// Theme, font, and display settings.
struct AppearanceSettings: View {
    @AppStorage("colorScheme") private var theme = "dark"
    @AppStorage("fontSize") private var fontSize: Double = 15
    @AppStorage("showProviderBadges") private var showProviderBadges = true
    @AppStorage("compactMessages") private var compactMessages = false

    var body: some View {
        List {
            // Theme
            Section("Theme") {
                Picker("Color Scheme", selection: $theme) {
                    Text("Dark").tag("dark")
                    Text("Light").tag("light")
                    Text("System").tag("system")
                }
                .pickerStyle(.segmented)
                .listRowBackground(WTheme.Colors.surface)
            }

            // Typography
            Section("Typography") {
                VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                    HStack {
                        Text("Font Size")
                        Spacer()
                        Text("\(Int(fontSize))pt")
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                    Slider(value: $fontSize, in: 12...20, step: 1)
                        .tint(WTheme.Colors.primary)
                }
                .listRowBackground(WTheme.Colors.surface)

                // Preview
                VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                    Text("Preview")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)

                    Text("The quick brown fox jumps over the lazy dog.")
                        .font(.system(size: fontSize))
                        .foregroundColor(WTheme.Colors.textPrimary)

                    Text("func greet() { print(\"Hello\") }")
                        .font(.system(size: fontSize - 1, design: .monospaced))
                        .foregroundColor(WTheme.Colors.primary)
                }
                .listRowBackground(WTheme.Colors.surface)
            }

            // Display
            Section("Display") {
                Toggle("Show Provider Badges", isOn: $showProviderBadges)
                    .tint(WTheme.Colors.primary)
                    .listRowBackground(WTheme.Colors.surface)

                Toggle("Compact Messages", isOn: $compactMessages)
                    .tint(WTheme.Colors.primary)
                    .listRowBackground(WTheme.Colors.surface)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(WTheme.Colors.background)
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack {
        AppearanceSettings()
    }
    .preferredColorScheme(.dark)
}
