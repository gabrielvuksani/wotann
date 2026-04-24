import SwiftUI

// MARK: - SignatureMotif — Rune-Flash Overlay (T7.6)
//
// The signature visual motif of WOTANN. Triggered on task success, relay
// delivered, autopilot landing — paired with `WHaptics.rune()` to form a
// coherent multisensory signature moment.
//
// Shape: a glass capsule in the cyan accent colour (`0x06B6D4` —
// `WotannTokens.Dark.accent`, also exposed as `Color.wotannCyan`), centred
// horizontally and offset 18% from the top of the safe area. Inside sits
// one of three runes from the WOTANN alphabet:
//
//   ᚠ  Ask          (fehu — 'wealth', used for prompts / chat)
//   ᚱ  Relay        (raidho — 'ride', used for phone→desktop relay)
//   ᛉ  Autopilot    (algiz — 'protection', used for autonomous runs)
//
// Motion: 200ms slide-in from the top (spring, no bounce), 800ms hold,
// 200ms slide-out. Reduce Motion collapses the transitions to a crossfade.

enum WotannRune: String, CaseIterable {
    /// Ask — fehu. Chat / prompt surfaces.
    case ask = "ᚠ"
    /// Relay — raidho. Phone→desktop relay landings.
    case relay = "ᚱ"
    /// Autopilot — algiz. Autonomous run completions.
    case autopilot = "ᛉ"
}

// MARK: - SignatureMotif View

struct SignatureMotif: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    let rune: WotannRune

    var body: some View {
        HStack(spacing: 10) {
            Text(rune.rawValue)
                .font(.system(size: 36, weight: .bold, design: .serif))
                .foregroundStyle(
                    LinearGradient(
                        colors: [Color.wotannCyan, Color.wotannCyan.opacity(0.72)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(
            Capsule(style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            Capsule(style: .continuous)
                .stroke(Color.wotannCyan.opacity(0.35), lineWidth: 0.8)
        )
        .shadow(color: Color.wotannCyan.opacity(0.45), radius: 16, x: 0, y: 4)
        .offset(y: appeared ? 0 : -32)
        .opacity(appeared ? 1 : 0)
        .onAppear {
            withAnimation(
                reduceMotion
                    ? .easeInOut(duration: 0.2)
                    : .spring(duration: 0.2, bounce: 0.0)
            ) {
                appeared = true
            }
        }
    }
}

// MARK: - RuneFlashOverlayModifier

/// Binds a transient `WotannRune?` to an overlay so any view can present
/// the signature motif by setting the rune and clearing it 800ms later.
/// Pairs with `WHaptics.rune()` at the same instant.
struct RuneFlashOverlayModifier: ViewModifier {
    @Binding var rune: WotannRune?
    /// Total on-screen time before auto-dismiss (ms).
    var dwellMillis: Int = 800

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let rune {
                SignatureMotif(rune: rune)
                    .padding(.top, 18)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(
                            nanoseconds: UInt64(dwellMillis) * 1_000_000
                        )
                        withAnimation(.spring(duration: 0.2, bounce: 0.0)) {
                            self.rune = nil
                        }
                    }
                    .accessibilityHidden(true)
            }
        }
    }
}

extension View {
    /// Bind a rune-flash overlay. Set the binding to a `WotannRune` to
    /// present; the overlay clears itself after `dwellMillis`.
    func wRuneFlash(
        _ rune: Binding<WotannRune?>,
        dwellMillis: Int = 800
    ) -> some View {
        modifier(RuneFlashOverlayModifier(rune: rune, dwellMillis: dwellMillis))
    }
}
