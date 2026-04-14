import SwiftUI

// MARK: - EmptyState

/// Placeholder view for empty collections.
/// Obsidian Precision variant: 64pt SF Symbol + 17pt semibold title +
/// 15pt secondary body + 44pt primary-button CTA.
///
/// Two initializers:
/// - Legacy: `(icon, title, subtitle, action?, actionTitle?)` — preserved for
///   the 9 existing call sites.
/// - New: `(icon, title, body, ctaLabel, action)` — explicit CTA contract.
struct EmptyState: View {
    let icon: String
    let title: String
    let subtitle: String
    var ctaLabel: String?
    var onTap: (() -> Void)?

    // MARK: Initializers

    /// Legacy init. Preserved verbatim so existing call sites still compile.
    init(
        icon: String,
        title: String,
        subtitle: String,
        action: (() -> Void)? = nil,
        actionTitle: String? = nil
    ) {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.ctaLabel = actionTitle
        self.onTap = action
    }

    /// Obsidian Precision init using explicit CTA naming.
    init(
        icon: String,
        title: String,
        body: String,
        ctaLabel: String,
        action: @escaping () -> Void
    ) {
        self.icon = icon
        self.title = title
        self.subtitle = body
        self.ctaLabel = ctaLabel
        self.onTap = action
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: WTheme.Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 64, weight: .regular))
                .foregroundColor(WTheme.Colors.textTertiary)
                .accessibilityHidden(true)

            Text(title)
                .font(WTheme.Typography.roundedHeadline)
                .foregroundColor(WTheme.Colors.textPrimary)
                .multilineTextAlignment(.center)

            Text(subtitle)
                .font(.system(size: 15, weight: .regular))
                .foregroundColor(WTheme.Colors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, WTheme.Spacing.xl)

            if let onTap, let ctaLabel {
                Button {
                    Haptics.shared.buttonTap()
                    onTap()
                } label: {
                    Text(ctaLabel)
                        .font(WTheme.Typography.roundedHeadline)
                        .foregroundColor(.white)
                        .padding(.horizontal, WTheme.Spacing.lg)
                        .frame(minWidth: 160, minHeight: 44)
                        .background(WTheme.Colors.primary)
                        .clipShape(Capsule())
                }
                .hitTarget()
                .padding(.top, WTheme.Spacing.sm)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - ErrorState

/// Error state with retry action.
struct ErrorState: View {
    let message: String
    var onRetry: (() -> Void)?

    var body: some View {
        if let onRetry {
            EmptyState(
                icon: "exclamationmark.triangle",
                title: "Something went wrong",
                body: message,
                ctaLabel: "Try Again",
                action: onRetry
            )
        } else {
            EmptyState(
                icon: "exclamationmark.triangle",
                title: "Something went wrong",
                subtitle: message
            )
        }
    }
}

// MARK: - DisconnectedState

/// Shows when the device is not connected to desktop.
struct DisconnectedState: View {
    var body: some View {
        EmptyState(
            icon: "wifi.slash",
            title: "Not Connected",
            subtitle: "Connect to your desktop WOTANN instance to see live data."
        )
    }
}

#Preview {
    VStack {
        EmptyState(
            icon: "bubble.left.and.bubble.right",
            title: "No Conversations",
            body: "Start a chat on your desktop or tap the button below.",
            ctaLabel: "New Chat",
            action: {}
        )
    }
    .preferredColorScheme(.dark)
}
