import SwiftUI

// MARK: - MessageContextMenu

/// Long-press context menu for a single message. Shows the Copy / Share /
/// Re-run / Re-run-with-different-model / Fork commands plus a 5-emoji
/// reaction row. Emitted as a `@ViewBuilder` so `MessageRow` can plug it
/// into SwiftUI's `.contextMenu { ... }` modifier directly.
///
/// All interactions are delivered through the supplied closures — the menu
/// itself holds no mutable state. The emoji list is immutable and
/// deterministic.
struct MessageContextMenu: View {
    let message: Message
    let onCopy: () -> Void
    let onShare: () -> Void
    let onRerun: (() -> Void)?
    let onRerunCompare: (() -> Void)?
    let onFork: (() -> Void)?
    let onReact: (String) -> Void

    /// The five reaction emoji. Kept in a fixed order so muscle memory
    /// builds over time.
    static let reactions: [String] = ["👍", "👎", "🔥", "😂", "❤️"]

    var body: some View {
        Group {
            // Reactions row
            Menu {
                ForEach(Self.reactions, id: \.self) { emoji in
                    Button(emoji) {
                        Haptics.shared.buttonTap()
                        onReact(emoji)
                    }
                }
            } label: {
                Label("React", systemImage: "face.smiling")
            }

            Divider()

            Button {
                onCopy()
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }

            Button {
                onShare()
            } label: {
                Label("Share", systemImage: "square.and.arrow.up")
            }

            if let onRerun {
                Button {
                    onRerun()
                } label: {
                    Label("Re-run", systemImage: "arrow.clockwise")
                }
            }

            if let onRerunCompare {
                Button {
                    onRerunCompare()
                } label: {
                    Label("Re-run with different model", systemImage: "rectangle.2.swap")
                }
            }

            if let onFork {
                Divider()
                Button {
                    onFork()
                } label: {
                    Label("Fork from here", systemImage: "arrow.triangle.branch")
                }
            }
        }
    }
}

// MARK: - ReactionBar

/// Visual strip showing any reactions already attached to a message.
/// Read-only; tapping a reaction merely re-emits the value for parents
/// that want to toggle it off.
struct ReactionBar: View {
    let reactions: [String: Int]
    var onTap: ((String) -> Void)? = nil

    var body: some View {
        if reactions.isEmpty {
            EmptyView()
        } else {
            HStack(spacing: 6) {
                ForEach(reactions.keys.sorted(), id: \.self) { emoji in
                    let count = reactions[emoji] ?? 0
                    Button {
                        onTap?(emoji)
                    } label: {
                        HStack(spacing: 3) {
                            Text(emoji)
                                .font(.system(size: 12))
                            if count > 1 {
                                Text("\(count)")
                                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                                    .foregroundColor(WTheme.Colors.textSecondary)
                            }
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(
                            Capsule(style: .continuous)
                                .fill(WTheme.Colors.surface)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

#Preview {
    VStack(spacing: 16) {
        ReactionBar(reactions: ["👍": 2, "🔥": 1])
        Text("Long-press a message to see context menu")
            .foregroundColor(WTheme.Colors.textSecondary)
    }
    .padding()
    .background(Color.black)
    .preferredColorScheme(.dark)
}
