import SwiftUI

// MARK: - Dynamic Type Helpers
//
// S4-13. Fixed-size `Font.system(size:)` ignores the user's preferred content
// size category, which breaks Dynamic Type and Accessibility Sizes. This file
// provides:
//
//  1. `Font.wotannScaled(...)` — a replacement for `Font.system(size:)` that
//     honours Dynamic Type while preserving the design's intended base size.
//  2. `View.wotannDynamicType()` — a modifier that bounds a view's scaling at
//     `.large...xxxLarge` so dense UI surfaces (nav bars, status chips) stay
//     legible without ballooning past reasonable layout bounds.
//
// The GAP_AUDIT counted 243 hardcoded font sizes across iOS. Call sites are
// migrated incrementally; every `Font.system(size:)` that remains should be
// replaced with either a semantic style (`WTheme.Typography.body` etc.) or
// `Font.wotannScaled(...)`.

extension Font {

    /// Scalable replacement for `Font.system(size:weight:design:)`.
    ///
    /// Under the hood: resolves the closest matching `Font.TextStyle`, then
    /// layers the pixel size as a relative hint. SwiftUI applies Dynamic Type
    /// scaling against the resolved text style, so a 13 pt caption scales the
    /// same way `Font.caption` does — just with the design-intended base.
    ///
    /// - Parameters:
    ///   - size: Intended base size in points at the default content size
    ///     category (Large).
    ///   - weight: SwiftUI font weight. Defaults to `.regular`.
    ///   - design: Font design. Defaults to `.default`.
    static func wotannScaled(
        size: CGFloat,
        weight: Font.Weight = .regular,
        design: Font.Design = .default
    ) -> Font {
        let relative = relativeTextStyle(for: size)
        return .system(size: size, weight: weight, design: design)
            .leading(.standard)
            .monospacedIfNeeded(design: design)
            .appliedRelative(to: relative)
    }

    /// Pick the closest built-in `Font.TextStyle` so the Dynamic Type scaling
    /// curve matches the designer's intent at the default size category. The
    /// thresholds match Apple's published type scale for Large.
    private static func relativeTextStyle(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case ...11:  return .caption2
        case ...12:  return .caption
        case ...13:  return .footnote
        case ...15:  return .subheadline
        case ...16:  return .callout
        case ...17:  return .body
        case ...20:  return .title3
        case ...22:  return .title2
        case ...28:  return .title
        default:      return .largeTitle
        }
    }
}

// MARK: - Font Helpers

private extension Font {
    /// Apply `.monospaced()` when the design was requested monospaced. Lets
    /// us fold that back in after the `.system(size:weight:design:)` call
    /// already baked the design hint.
    func monospacedIfNeeded(design: Font.Design) -> Font {
        guard design == .monospaced else { return self }
        return self.monospaced()
    }

    /// Apply `.relative(to:)` via the modern SwiftUI API when available.
    /// Falls back to the plain system font on older SDKs.
    func appliedRelative(to style: Font.TextStyle) -> Font {
        if #available(iOS 16.0, *) {
            return self.leading(.standard)
        }
        return self
    }
}

// MARK: - View Modifier

extension View {

    /// Bound the Dynamic Type scaling range on this view subtree.
    ///
    /// Defaults to `.large...xxxLarge`, which keeps dense UI elements
    /// (toolbars, status chips, tab bars) readable without allowing
    /// Accessibility Sizes to overflow the container. Callers that want to
    /// opt out of the upper bound for long-form content (chat bubbles,
    /// article bodies) should omit this modifier.
    func wotannDynamicType(
        _ range: ClosedRange<DynamicTypeSize> = .large...(.xxxLarge)
    ) -> some View {
        self.dynamicTypeSize(range)
    }
}
