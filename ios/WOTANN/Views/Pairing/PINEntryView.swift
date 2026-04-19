import SwiftUI

// MARK: - PINEntryView

/// 6-character PIN verification display with confirmation buttons.
struct PINEntryView: View {
    let pin: String
    let onConfirm: () -> Void
    let onReject: () -> Void
    @State private var revealed = false

    var body: some View {
        VStack(spacing: WTheme.Spacing.xl) {
            // Icon
            Image(systemName: "lock.shield.fill")
                .font(.wotannScaled(size: 48))
                .foregroundStyle(
                    LinearGradient(
                        colors: [WTheme.Colors.primary, .wotannCyan],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            // Title
            VStack(spacing: WTheme.Spacing.sm) {
                Text("Verify Connection")
                    .font(WTheme.Typography.title2)
                    .foregroundColor(WTheme.Colors.textPrimary)

                Text("Does this PIN match the one shown\non your desktop?")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .multilineTextAlignment(.center)
            }

            // PIN display
            HStack(spacing: WTheme.Spacing.sm) {
                ForEach(Array(pin.enumerated()), id: \.offset) { index, character in
                    Text(String(character))
                        .font(.wotannScaled(size: 32, weight: .bold, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .frame(width: 44, height: 56)
                        .background(WTheme.Colors.surface)
                        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                        .overlay(
                            RoundedRectangle(cornerRadius: WTheme.Radius.sm)
                                .strokeBorder(WTheme.Colors.primary.opacity(0.3), lineWidth: 1)
                        )
                        .scaleEffect(revealed ? 1.0 : 0.8)
                        .opacity(revealed ? 1.0 : 0)
                        .animation(
                            WTheme.Animation.bouncy.delay(Double(index) * 0.08),
                            value: revealed
                        )
                }
            }
            .padding(.vertical, WTheme.Spacing.md)

            // Buttons
            VStack(spacing: WTheme.Spacing.sm) {
                Button(action: onConfirm) {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                        Text("Yes, it matches")
                    }
                    .font(WTheme.Typography.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WTheme.Spacing.md)
                    .background(WTheme.Colors.success)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                }

                Button(action: onReject) {
                    HStack {
                        Image(systemName: "xmark.circle.fill")
                        Text("No, cancel pairing")
                    }
                    .font(WTheme.Typography.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WTheme.Spacing.md)
                    .background(WTheme.Colors.surface)
                    .foregroundColor(WTheme.Colors.error)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                    .overlay(
                        RoundedRectangle(cornerRadius: WTheme.Radius.md)
                            .strokeBorder(WTheme.Colors.error.opacity(0.3), lineWidth: 1)
                    )
                }
            }
            .padding(.horizontal, WTheme.Spacing.xl)
        }
        .padding()
        .onAppear {
            withAnimation {
                revealed = true
            }
        }
    }
}

#Preview {
    PINEntryView(pin: "847293", onConfirm: {}, onReject: {})
        .background(WTheme.Colors.background)
        .preferredColorScheme(.dark)
}
