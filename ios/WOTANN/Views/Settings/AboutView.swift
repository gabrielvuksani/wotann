import SwiftUI

// MARK: - AboutView

/// App info, version, and links.
struct AboutView: View {
    @State private var logoScale: CGFloat = 0.9

    var body: some View {
        ScrollView {
            VStack(spacing: WTheme.Spacing.xl) {
                Spacer(minLength: WTheme.Spacing.xl)

                // Logo
                VStack(spacing: WTheme.Spacing.md) {
                    WLogo(size: 64, glowRadius: 16)
                        .scaleEffect(logoScale)

                    Text("WOTANN")
                        .font(.wotannScaled(size: 36, weight: .black, design: .rounded))
                        .foregroundColor(WTheme.Colors.textPrimary)

                    Text("The All-Father of AI")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }

                // Version info
                VStack(spacing: WTheme.Spacing.sm) {
                    DetailRow(label: "Version", value: appVersion)
                    DetailRow(label: "Build", value: appBuild)
                    DetailRow(label: "Platform", value: "iOS 18+")
                    DetailRow(label: "Framework", value: "SwiftUI")
                }
                .wCard()

                // Description
                VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                    Text("About")
                        .font(WTheme.Typography.headline)
                        .foregroundColor(WTheme.Colors.textPrimary)

                    Text("WOTANN is a unified AI agent harness that connects to 11+ providers. This companion app gives you remote control over your desktop instance -- dispatch tasks, monitor agents, track costs, and chat from anywhere.")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textSecondary)
                        .lineSpacing(4)
                }
                .wCard()

                // Links
                VStack(spacing: WTheme.Spacing.sm) {
                    linkRow(title: "Website", url: "https://wotann.com", icon: "globe")
                    linkRow(title: "GitHub", url: "https://github.com/wotann", icon: "chevron.left.forwardslash.chevron.right")
                    linkRow(title: "Documentation", url: "https://docs.wotann.com", icon: "book")
                }
                .wCard()

                // H-K8 fix: Open Source Acknowledgements. Apple App Review
                // expects MIT/Apache/BSD-licensed third-party code to be
                // attributable from the binary itself. Link to a dedicated
                // view rather than dumping ~100 entries inline.
                VStack(spacing: WTheme.Spacing.sm) {
                    NavigationLink(destination: OpenSourceLicensesView()) {
                        HStack(spacing: WTheme.Spacing.sm) {
                            Image(systemName: "scroll")
                                .foregroundColor(WTheme.Colors.primary)
                                .frame(width: 24)
                            Text("Open Source Licenses")
                                .font(WTheme.Typography.subheadline)
                                .foregroundColor(WTheme.Colors.textPrimary)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundColor(WTheme.Colors.textTertiary)
                        }
                    }
                }
                .wCard()

                // Credits
                Text("Built with care by Gabriel Vuksani")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)

                Spacer(minLength: WTheme.Spacing.xl)
            }
            .padding()
        }
        .background(WTheme.Colors.background)
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: true)) {
                logoScale = 1.05
            }
        }
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
    }

    private var appBuild: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }

    private func linkRow(title: String, url: String, icon: String) -> some View {
        Link(destination: URL(string: url)!) {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: icon)
                    .foregroundColor(WTheme.Colors.primary)
                    .frame(width: 24)
                Text(title)
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
    }
}

#Preview {
    NavigationStack {
        AboutView()
    }
    .preferredColorScheme(.dark)
}
