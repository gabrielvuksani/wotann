import SwiftUI

// MARK: - ArtifactView

/// Phase C artifact preview card. Renders a 16pt rounded card with the
/// language badge in the top-right corner, an 8-line preview of the
/// content, a bottom gradient fade to signal overflow, and an
/// "Open editor" button that launches `ArtifactEditorView` in a
/// full-screen sheet. No inline expansion: the editor handles the full
/// view so chat flow stays compact.
struct ArtifactView: View {
    let artifact: Artifact
    @State private var showEditor = false

    private static let previewLineCount = 8

    private var preview: String {
        let lines = artifact.content
            .split(separator: "\n", omittingEmptySubsequences: false)
            .prefix(Self.previewLineCount)
            .map(String.init)
        return lines.joined(separator: "\n")
    }

    private var hasOverflow: Bool {
        artifact.content.split(separator: "\n", omittingEmptySubsequences: false).count
            > Self.previewLineCount
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            previewBody
            footer
        }
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(WTheme.Colors.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(artifactColor.opacity(0.3), lineWidth: 0.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .sheet(isPresented: $showEditor) {
            ArtifactEditorView(artifact: artifact)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Image(systemName: artifactIcon)
                .font(.wotannScaled(size: 11, weight: .semibold))
                .foregroundColor(artifactColor)
                .frame(width: 22, height: 22)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(artifactColor.opacity(0.15))
                )

            Text(artifact.title ?? artifact.type.rawValue.capitalized)
                .font(.wotannScaled(size: 13, weight: .semibold, design: .rounded))
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(1)

            Spacer(minLength: 4)

            if let lang = artifact.language, !lang.isEmpty {
                Text(lang.uppercased())
                    .font(.wotannScaled(size: 9, weight: .bold, design: .monospaced))
                    .tracking(0.5)
                    .foregroundColor(artifactColor)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(
                        Capsule(style: .continuous)
                            .fill(artifactColor.opacity(0.12))
                    )
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
    }

    // MARK: - Preview

    private var previewBody: some View {
        ZStack(alignment: .bottom) {
            Text(preview)
                .font(.wotannScaled(size: 12, design: .monospaced))
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineSpacing(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.bottom, 8)

            if hasOverflow {
                LinearGradient(
                    colors: [
                        WTheme.Colors.surface.opacity(0),
                        WTheme.Colors.surface,
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 36)
                .allowsHitTesting(false)
            }
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            Spacer()
            Button {
                Haptics.shared.buttonTap()
                showEditor = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.up.right.square")
                        .font(.wotannScaled(size: 11, weight: .semibold))
                    Text("Open editor")
                        .font(.wotannScaled(size: 12, weight: .semibold, design: .rounded))
                }
                .foregroundColor(WTheme.Colors.primary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    Capsule(style: .continuous)
                        .fill(WTheme.Colors.primary.opacity(0.12))
                )
            }
            .accessibilityLabel("Open artifact in editor")
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 10)
    }

    // MARK: - Icon / Color

    private var artifactIcon: String {
        switch artifact.type {
        case .code:     return "chevron.left.forwardslash.chevron.right"
        case .diff:     return "plus.forwardslash.minus"
        case .diagram:  return "circle.grid.cross"
        case .table:    return "tablecells"
        case .chart:    return "chart.xyaxis.line"
        case .document: return "doc.text"
        }
    }

    private var artifactColor: Color {
        switch artifact.type {
        case .code:     return WTheme.Colors.primary
        case .diff:     return WTheme.Colors.warning
        case .diagram:  return .wotannCyan
        case .table:    return WTheme.Colors.success
        case .chart:    return WTheme.Colors.chartAccent
        case .document: return WTheme.Colors.textSecondary
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        ArtifactView(artifact: Artifact(
            type: .code,
            content: """
            func hello() {
                print("Hello, WOTANN!")
            }

            struct Example {
                let name: String
            }

            extension Example {
                func greet() {
                    print("Hi \\(name)")
                }
            }
            """,
            language: "swift",
            title: "Greeting.swift"
        ))
        ArtifactView(artifact: Artifact(
            type: .diff,
            content: "+ added line\n- removed line",
            title: "Changes"
        ))
    }
    .padding()
    .background(Color.black)
    .preferredColorScheme(.dark)
}
