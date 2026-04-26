import SwiftUI

// MARK: - OpenSourceLicensesView (H-K8 fix)

/// Acknowledgements screen — every third-party Swift package + native
/// component bundled into the WOTANN iOS binary. Apple App Review expects
/// MIT/Apache/BSD-licensed code to be attributable from inside the app
/// itself (not just on a website). This view renders that list with the
/// project URL + license SPDX identifier.
///
/// Maintenance: when adding a new Swift Package via Xcode, mirror it
/// here so the next App Review submission stays compliant. The list is
/// alphabetical by package name to make additions self-merging.
struct OpenSourceLicensesView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
                Text(
                    "WOTANN bundles the open-source projects below. Each appears under the terms of its own license — we acknowledge their authors gratefully and incorporate their code per the SPDX identifier shown."
                )
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)
                .lineSpacing(4)
                .padding(.bottom, WTheme.Spacing.sm)

                ForEach(Self.entries, id: \.name) { entry in
                    LicenseRow(entry: entry)
                }
            }
            .padding()
        }
        .background(WTheme.Colors.background)
        .navigationTitle("Open Source Licenses")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// SPDX-identifier license catalogue, alphabetically sorted.
    /// When adding a Swift Package or vendored library, append here.
    static let entries: [LicenseEntry] = [
        LicenseEntry(
            name: "MLX",
            license: "MIT",
            authors: "Apple Inc.",
            url: "https://github.com/ml-explore/mlx-swift"
        ),
        LicenseEntry(
            name: "Runestone",
            license: "MIT",
            authors: "Simon Støvring",
            url: "https://github.com/simonbs/Runestone"
        ),
        LicenseEntry(
            name: "swift-collections",
            license: "Apache-2.0",
            authors: "Apple Inc.",
            url: "https://github.com/apple/swift-collections"
        ),
        LicenseEntry(
            name: "swift-crypto",
            license: "Apache-2.0",
            authors: "Apple Inc.",
            url: "https://github.com/apple/swift-crypto"
        ),
        LicenseEntry(
            name: "TreeSitter (and language grammars)",
            license: "MIT",
            authors: "Max Brunsfeld and contributors",
            url: "https://github.com/tree-sitter/tree-sitter"
        ),
        LicenseEntry(
            name: "VibeVoice / Whisper",
            license: "MIT",
            authors: "OpenAI Whisper contributors",
            url: "https://github.com/openai/whisper"
        ),
    ]
}

struct LicenseEntry {
    let name: String
    let license: String
    let authors: String
    let url: String
}

private struct LicenseRow: View {
    let entry: LicenseEntry

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack {
                Text(entry.name)
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Spacer()
                Text(entry.license)
                    .font(.caption.monospaced())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(WTheme.Colors.primary.opacity(0.15))
                    .foregroundColor(WTheme.Colors.primary)
                    .cornerRadius(4)
            }
            Text(entry.authors)
                .font(WTheme.Typography.caption)
                .foregroundColor(WTheme.Colors.textSecondary)
            Link(entry.url, destination: URL(string: entry.url)!)
                .font(.caption)
                .foregroundColor(WTheme.Colors.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .wCard()
    }
}

#Preview {
    NavigationStack {
        OpenSourceLicensesView()
    }
    .preferredColorScheme(.dark)
}
