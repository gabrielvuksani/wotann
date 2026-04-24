import SwiftUI
import UIKit

// MARK: - CreationShareButton
//
// V9 T5.6 (F7) — share a creation via the native iOS share sheet
// (iMessage, Mail, Files, AirDrop). Used as a long-press context
// action and as a toolbar item inside the creation detail view.
//
// CreationsView already uses the built-in SwiftUI `ShareLink` for the
// simple text path. This file adds the `UIActivityViewController`
// bridge for cases where we need to share a file URL (binary
// creations, large diffs) where a text payload would be truncated
// or incorrectly routed. The iOS 16+ `ShareLink` cannot share a
// `URL` that points to a local file in an ad-hoc manner without
// persisting the bytes first — this bridge handles that.
//
// QUALITY BARS
// - #6 (honest stubs): `presentShareSheet` silently fails only when
//   there is no window to present from (unit-test safe); callers
//   treat that as a bug to surface.

struct CreationShareButton: View {
    let creation: Creation

    var body: some View {
        Button {
            presentShareSheet()
        } label: {
            Label("Share", systemImage: "square.and.arrow.up")
        }
        .accessibilityLabel("Share \(creation.title)")
    }

    // MARK: - Present

    /// Build the share items and hand off to `UIActivityViewController`
    /// via the topmost foreground scene's root view controller.
    private func presentShareSheet() {
        let items: [Any] = Self.buildShareItems(for: creation)

        let controller = UIActivityViewController(
            activityItems: items,
            applicationActivities: nil
        )

        // iPad popover anchor — required so iPad doesn't crash when
        // presenting a share sheet from a non-bar-button source.
        if let popover = controller.popoverPresentationController,
           let root = Self.topViewController()?.view {
            popover.sourceView = root
            popover.sourceRect = CGRect(
                x: root.bounds.midX,
                y: root.bounds.midY,
                width: 0,
                height: 0
            )
            popover.permittedArrowDirections = []
        }

        Self.topViewController()?.present(controller, animated: true)
    }

    // MARK: - Helpers

    /// Build the payload for the share sheet. When the creation has a
    /// `path` on disk we share the `URL`; otherwise we fall back to a
    /// text representation so iMessage/Mail still have something to
    /// send.
    static func buildShareItems(for creation: Creation) -> [Any] {
        var items: [Any] = []

        if let path = creation.path, !path.isEmpty {
            let url = URL(fileURLWithPath: path)
            if FileManager.default.fileExists(atPath: path) {
                items.append(url)
            }
        }

        if items.isEmpty {
            // Text fallback — everything that can receive a string
            // (iMessage, Mail, Notes) can render this.
            items.append(creation.shareRepresentation)
        }

        return items
    }

    /// Walk the foreground scene's view-controller hierarchy to find
    /// a suitable presenter. Returns `nil` in non-UI contexts (tests,
    /// extensions) — callers then treat `presentShareSheet` as a no-op.
    private static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first

        guard let window = scene?.windows.first(where: { $0.isKeyWindow })
            ?? scene?.windows.first else {
            return nil
        }

        var top = window.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
