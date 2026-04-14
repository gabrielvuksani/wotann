import SwiftUI

// MARK: - MessageRow

/// Phase C message row.
///
/// * User messages are right-aligned inside a rounded 20pt blue bubble
///   with white text.
/// * Assistant messages are left-aligned borderless text on OLED black —
///   no bubble, no border, just the conversation flowing across the
///   display.
/// * Long-press opens `MessageContextMenu` (copy / share / re-run /
///   re-run-with-different-model / fork / 5-emoji reactions).
/// * A horizontal drag of ≥60pt from the leading edge triggers a
///   "reply-quote" action: a haptic fires and the parent receives the
///   message content via `onReply`, which typically inserts the text as a
///   quoted block into the composer.
struct MessageRow: View {
    let message: Message
    var onRegenerate: (() -> Void)?
    var onDelete: (() -> Void)?
    var onReply: ((Message) -> Void)?
    var onRerunCompare: (() -> Void)?
    var onFork: (() -> Void)?
    var onReact: ((String) -> Void)?

    @State private var isCopied = false
    @State private var dragOffset: CGFloat = 0
    @State private var didTriggerReply = false

    /// Swipe-right-to-reply threshold in points.
    private let replyThreshold: CGFloat = 60

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if isUser { Spacer(minLength: WTheme.Spacing.xl) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                if !isUser { assistantHeader }

                content

                if !message.artifacts.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(message.artifacts) { artifact in
                            ArtifactView(artifact: artifact)
                        }
                    }
                    .padding(.top, 4)
                }

                if !message.isStreaming {
                    footer
                }
            }
            .frame(maxWidth: isUser ? .infinity : .infinity, alignment: isUser ? .trailing : .leading)

            if !isUser { Spacer(minLength: WTheme.Spacing.xl) }
        }
        .padding(.horizontal, 4)
        .offset(x: max(0, dragOffset))
        .overlay(alignment: .leading) {
            replyIndicator
        }
        .simultaneousGesture(swipeGesture)
        .contextMenu {
            MessageContextMenu(
                message: message,
                onCopy: copyMessage,
                onShare: shareMessage,
                onRerun: onRegenerate,
                onRerunCompare: onRerunCompare,
                onFork: onFork,
                onReact: { emoji in onReact?(emoji) }
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityDescription)
        .accessibilityHint("Long press for options. Swipe right to reply.")
    }

    // MARK: - Assistant Header

    private var assistantHeader: some View {
        HStack(spacing: 6) {
            Image(systemName: "sparkle")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(WTheme.Colors.primary)
            Text("WOTANN")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .tracking(0.3)
                .foregroundColor(WTheme.Colors.primary)
            if let model = message.model {
                Text(model)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
        .padding(.bottom, 2)
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if isUser {
            userBubble
        } else {
            assistantBody
        }
    }

    private var userBubble: some View {
        Text(message.content)
            .font(.system(size: 16))
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(WTheme.Colors.primary)
            )
            .frame(maxWidth: 320, alignment: .trailing)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var assistantBody: some View {
        if message.isStreaming && message.content.isEmpty {
            StreamingView()
                .frame(height: 2)
                .padding(.trailing, 40)
                .padding(.vertical, 6)
        } else {
            MarkdownView(text: message.content)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack(spacing: 10) {
            if isUser { Spacer() }

            Text(message.timestamp, style: .time)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(WTheme.Colors.textTertiary)

            if let tokens = message.tokensUsed {
                Text("\(tokens) tok")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textTertiary)
            }

            if let cost = message.cost, cost > 0 {
                CostLabel(amount: cost, style: .compact)
            }

            if isCopied {
                Text("Copied")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundColor(WTheme.Colors.success)
                    .transition(.opacity)
            }

            if !isUser { Spacer() }
        }
        .padding(.top, 2)
    }

    // MARK: - Swipe-to-Reply

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                let tx = value.translation.width
                guard tx > 0 else { return }
                dragOffset = min(tx, 120)
                if !didTriggerReply, tx >= replyThreshold {
                    didTriggerReply = true
                    Haptics.shared.buttonTap()
                }
            }
            .onEnded { value in
                let tx = value.translation.width
                if tx >= replyThreshold {
                    Haptics.shared.success()
                    onReply?(message)
                }
                withAnimation(.spring(duration: 0.3, bounce: 0.2)) {
                    dragOffset = 0
                }
                didTriggerReply = false
            }
    }

    @ViewBuilder
    private var replyIndicator: some View {
        if dragOffset > 10 {
            Image(systemName: "arrowshape.turn.up.left.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(
                    dragOffset >= replyThreshold
                        ? WTheme.Colors.primary
                        : WTheme.Colors.textTertiary
                )
                .opacity(min(1, dragOffset / replyThreshold))
                .padding(.leading, 12)
        }
    }

    // MARK: - Actions

    private func copyMessage() {
        UIPasteboard.general.string = message.content
        Haptics.shared.buttonTap()
        withAnimation {
            isCopied = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation { isCopied = false }
        }
    }

    private func shareMessage() {
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
              let rootVC = windowScene.keyWindow?.rootViewController else { return }

        let activity = UIActivityViewController(
            activityItems: [message.content],
            applicationActivities: nil
        )
        // Present topmost
        var presenter: UIViewController = rootVC
        while let top = presenter.presentedViewController {
            presenter = top
        }
        presenter.present(activity, animated: true)
    }

    private var accessibilityDescription: String {
        let role = isUser ? "You said" : "WOTANN responded"
        let cost = message.cost.map { String(format: ", cost $%.4f", $0) } ?? ""
        let tokens = message.tokensUsed.map { ", \($0) tokens" } ?? ""
        return "\(role): \(message.content)\(tokens)\(cost)"
    }
}
