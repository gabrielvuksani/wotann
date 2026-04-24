import SwiftUI
import ImageIO
import UniformTypeIdentifiers
import os.log

// MARK: - RemoteDesktopView

/// Lightweight remote desktop viewer -- see and control the Mac from iPhone.
/// Sends RPC calls to the desktop CompanionServer for screen capture and input.
struct RemoteDesktopView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = RemoteDesktopViewModel()

    var body: some View {
        NavigationStack {
            RemoteDesktopContent(viewModel: viewModel)
                .environmentObject(connectionManager)
                .navigationTitle("Desktop Control")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Disconnect") {
                            viewModel.disconnect()
                            dismiss()
                        }
                        .foregroundColor(WTheme.Colors.error)
                        .accessibilityLabel("Disconnect from remote desktop")
                    }
                    ToolbarItem(placement: .principal) {
                        connectionStatusBadge
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            qualityPicker
                            Divider()
                            Button {
                                viewModel.showKeyboard.toggle()
                            } label: {
                                Label(
                                    viewModel.showKeyboard ? "Hide Keyboard" : "Show Keyboard",
                                    systemImage: viewModel.showKeyboard ? "keyboard.chevron.compact.down" : "keyboard"
                                )
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                                .foregroundColor(WTheme.Colors.textSecondary)
                        }
                        .accessibilityLabel("Desktop control options")
                        .accessibilityHint("Open menu for quality settings and keyboard toggle")
                    }
                }
                .onAppear {
                    viewModel.configure(rpcClient: connectionManager.rpcClient)
                    viewModel.startCapture()
                }
                .onDisappear {
                    viewModel.disconnect()
                }
        }
    }

    // MARK: - Connection Status Badge

    private var connectionStatusBadge: some View {
        HStack(spacing: WTheme.Spacing.xs) {
            Circle()
                .fill(viewModel.isConnected ? WTheme.Colors.success : WTheme.Colors.error)
                .frame(width: 8, height: 8)
            Text("Desktop Control")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)
        }
    }

    // MARK: - Quality Picker

    @ViewBuilder
    private var qualityPicker: some View {
        ForEach(CaptureQuality.allCases) { quality in
            Button {
                viewModel.quality = quality
            } label: {
                HStack {
                    Text(quality.label)
                    if viewModel.quality == quality {
                        Image(systemName: "checkmark")
                    }
                }
            }
        }
    }
}

// MARK: - RemoteDesktopContent

/// Inner content for the remote desktop viewer.
private struct RemoteDesktopContent: View {
    @ObservedObject var viewModel: RemoteDesktopViewModel
    @EnvironmentObject var connectionManager: ConnectionManager
    @Environment(\.accessibilityReduceMotion) var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            if !connectionManager.isConnected {
                disconnectedBanner
            }

            if let errorMessage = viewModel.errorMessage {
                ErrorBanner(
                    message: errorMessage,
                    type: .error,
                    onRetry: { viewModel.errorMessage = nil }
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            ZStack {
                screenDisplay

                // Touch ripple — shows where you tapped
                if let tapPoint = viewModel.lastTapPoint {
                    TapRippleView(at: tapPoint)
                }

                // Minimap — visible when zoomed past 1.5x
                if viewModel.zoomScale > 1.5, viewModel.screenImage != nil {
                    minimapOverlay
                }
            }
            .frame(maxHeight: .infinity)

            // Zoom toolbar
            zoomToolbar
            Divider().background(WTheme.Colors.border)

            // Quick shortcuts bar
            quickShortcutsBar
            Divider().background(WTheme.Colors.border)

            statusBar

            if viewModel.showKeyboard {
                Divider().background(WTheme.Colors.border)
                keyboardInputBar
            }
        }
        .background(WTheme.Colors.background)
    }

    // MARK: - Disconnected Banner

    private var disconnectedBanner: some View {
        ErrorBanner(
            message: "Not connected to desktop",
            type: .disconnected,
            onRetry: {
                if let device = connectionManager.pairedDevice {
                    connectionManager.connect(host: device.host, port: device.port)
                }
            }
        )
    }

    // MARK: - Screen Display

    private var screenDisplay: some View {
        GeometryReader { geometry in
            let computedHeight = imageHeight(for: geometry.size.width) * viewModel.zoomScale
            // Ensure height is never 0 — a 0-height frame causes
            // "Failed to create WxH image slot" errors from CoreGraphics.
            let safeHeight = max(computedHeight, geometry.size.height, 1)

            ScrollView([.horizontal, .vertical], showsIndicators: false) {
                screenImage(in: geometry)
                    .frame(
                        width: max(geometry.size.width * viewModel.zoomScale, geometry.size.width),
                        height: safeHeight
                    )
            }
            .gesture(magnificationGesture)
            .gesture(tapGesture(in: geometry))
            .gesture(doubleTapGesture(in: geometry))
            .gesture(longPressGesture(in: geometry))
            .gesture(dragGesture(in: geometry))
        }
    }

    @ViewBuilder
    private func screenImage(in geometry: GeometryProxy) -> some View {
        if let image = viewModel.screenImage {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: geometry.size.width * viewModel.zoomScale)
                .accessibilityLabel("Remote desktop screen")
                .accessibilityHint("Tap to click, long press to right-click, drag to move")
        } else if viewModel.isLoading {
            loadingPlaceholder
        } else {
            emptyScreenPlaceholder
        }
    }

    private var loadingPlaceholder: some View {
        VStack(spacing: WTheme.Spacing.md) {
            ProgressView()
                .tint(WTheme.Colors.primary)
            Text("Capturing screen...")
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WTheme.Colors.surface)
    }

    private var emptyScreenPlaceholder: some View {
        VStack(spacing: WTheme.Spacing.md) {
            Image(systemName: "desktopcomputer")
                .font(.wotannScaled(size: 48))
                .foregroundColor(WTheme.Colors.textTertiary)
            Text("No screen captured")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textSecondary)
            Text("Connect to your desktop to begin")
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WTheme.Colors.surface)
    }

    // MARK: - Gestures

    private var magnificationGesture: some Gesture {
        MagnificationGesture()
            .onChanged { scale in
                let newScale = viewModel.lastZoomScale * scale
                viewModel.zoomScale = min(max(newScale, 1.0), 5.0)
            }
            .onEnded { _ in
                viewModel.lastZoomScale = viewModel.zoomScale
            }
    }

    private func tapGesture(in geometry: GeometryProxy) -> some Gesture {
        SpatialTapGesture()
            .onEnded { value in
                let screenPoint = translateToScreenCoordinates(
                    point: value.location,
                    viewSize: geometry.size
                )
                viewModel.sendClick(at: screenPoint)
                viewModel.markInteraction()
                // Show tap ripple at the view-local position
                withAnimation(.easeOut(duration: 0.3)) {
                    viewModel.lastTapPoint = value.location
                }
                // Clear after animation
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    withAnimation { viewModel.lastTapPoint = nil }
                }
                HapticService.shared.trigger(.buttonTap)
            }
    }

    private func doubleTapGesture(in geometry: GeometryProxy) -> some Gesture {
        SpatialTapGesture(count: 2)
            .onEnded { value in
                let screenPoint = translateToScreenCoordinates(
                    point: value.location,
                    viewSize: geometry.size
                )
                viewModel.sendDoubleClick(at: screenPoint)
                HapticService.shared.trigger(.buttonTap)
            }
    }

    private func longPressGesture(in geometry: GeometryProxy) -> some Gesture {
        LongPressGesture(minimumDuration: 0.5)
            .sequenced(before: SpatialTapGesture())
            .onEnded { value in
                if case .second(_, let tap) = value, let tapValue = tap {
                    let screenPoint = translateToScreenCoordinates(
                        point: tapValue.location,
                        viewSize: geometry.size
                    )
                    viewModel.sendRightClick(at: screenPoint)
                    HapticService.shared.trigger(.selection)
                }
            }
    }

    private func dragGesture(in geometry: GeometryProxy) -> some Gesture {
        DragGesture(minimumDistance: 10)
            .onEnded { value in
                let distance = hypot(
                    value.location.x - value.startLocation.x,
                    value.location.y - value.startLocation.y
                )

                // Use predicted end location to estimate velocity --
                // large overshoot means a fast flick (scroll), small overshoot
                // means a deliberate drag.
                let predictedDistance = hypot(
                    value.predictedEndLocation.x - value.startLocation.x,
                    value.predictedEndLocation.y - value.startLocation.y
                )
                let isFastSwipe = predictedDistance > distance * 2.0

                // Short, fast swipes are scroll events; long drags are actual drags
                if distance < 150 && isFastSwipe {
                    let deltaX = value.location.x - value.startLocation.x
                    let deltaY = value.location.y - value.startLocation.y
                    let screenPoint = translateToScreenCoordinates(
                        point: value.startLocation,
                        viewSize: geometry.size
                    )

                    if abs(deltaY) > abs(deltaX) {
                        let direction = deltaY < 0 ? "up" : "down"
                        let amount = max(1, Int(abs(deltaY) / 30))
                        viewModel.sendScroll(at: screenPoint, direction: direction, amount: amount)
                    } else {
                        let direction = deltaX < 0 ? "left" : "right"
                        let amount = max(1, Int(abs(deltaX) / 30))
                        viewModel.sendScroll(at: screenPoint, direction: direction, amount: amount)
                    }
                    HapticService.shared.trigger(.swipe)
                } else {
                    let startPoint = translateToScreenCoordinates(
                        point: value.startLocation,
                        viewSize: geometry.size
                    )
                    let endPoint = translateToScreenCoordinates(
                        point: value.location,
                        viewSize: geometry.size
                    )
                    viewModel.sendDrag(from: startPoint, to: endPoint)
                    HapticService.shared.trigger(.swipe)
                }
            }
    }

    /// Translate a point in the view's coordinate space to the remote screen's coordinates.
    private func translateToScreenCoordinates(point: CGPoint, viewSize: CGSize) -> CGPoint {
        let displayWidth = viewSize.width * viewModel.zoomScale
        let displayHeight = imageHeight(for: viewSize.width) * viewModel.zoomScale

        let ratioX = point.x / displayWidth
        let ratioY = point.y / displayHeight

        return CGPoint(
            x: ratioX * CGFloat(viewModel.screenWidth),
            y: ratioY * CGFloat(viewModel.screenHeight)
        )
    }

    /// Calculate the image height maintaining aspect ratio for the given width.
    private func imageHeight(for width: CGFloat) -> CGFloat {
        guard viewModel.screenWidth > 0 else { return width * 0.625 }
        let aspectRatio = CGFloat(viewModel.screenHeight) / CGFloat(viewModel.screenWidth)
        return width * aspectRatio
    }

    // MARK: - Status Bar

    private var statusBar: some View {
        HStack(spacing: WTheme.Spacing.md) {
            HStack(spacing: WTheme.Spacing.xs) {
                Image(systemName: "speedometer")
                    .font(.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
                Text(String(format: "%.1f fps", viewModel.frameRate))
                    .font(WTheme.Typography.codeSmall)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Frame rate: \(String(format: "%.1f", viewModel.frameRate)) frames per second")

            HStack(spacing: WTheme.Spacing.xs) {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.caption2)
                    .foregroundColor(latencyColor)
                Text(latencyText)
                    .font(WTheme.Typography.codeSmall)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Latency: \(latencyText)")

            Spacer()

            HStack(spacing: WTheme.Spacing.xs) {
                Image(systemName: "display")
                    .font(.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
                Text("\(viewModel.screenWidth)x\(viewModel.screenHeight)")
                    .font(WTheme.Typography.codeSmall)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Resolution: \(viewModel.screenWidth) by \(viewModel.screenHeight)")

            Text(viewModel.quality.label)
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.primary)
                .padding(.horizontal, WTheme.Spacing.sm)
                .padding(.vertical, WTheme.Spacing.xxs)
                .background(WTheme.Colors.primary.opacity(0.1))
                .clipShape(Capsule())
                .accessibilityLabel("Quality: \(viewModel.quality.label)")
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
        // T7.3 — Status bar Liquid Glass surface.
        .wLiquidGlass(in: Rectangle())
    }

    private var latencyText: String {
        let ms = connectionManager.latencyMs
        if ms < 0 { return "N/A" }
        return String(format: "%.0f ms", ms)
    }

    private var latencyColor: Color {
        let ms = connectionManager.latencyMs
        if ms < 0 { return WTheme.Colors.textTertiary }
        if ms < 100 { return WTheme.Colors.success }
        if ms < 300 { return WTheme.Colors.warning }
        return WTheme.Colors.error
    }

    // MARK: - Keyboard Input Bar

    private var keyboardInputBar: some View {
        VStack(spacing: WTheme.Spacing.sm) {
            specialKeysRow

            HStack(spacing: WTheme.Spacing.sm) {
                TextField("Type to send keystrokes...", text: $viewModel.keyboardText)
                    .font(WTheme.Typography.body)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .padding(.vertical, WTheme.Spacing.sm)
                    .background(WTheme.Colors.surfaceAlt)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous)
                            .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
                    )
                    .onSubmit {
                        viewModel.sendKeyboardText()
                    }
                    .accessibilityLabel("Keyboard input")
                    .accessibilityHint("Type text to send to the remote desktop. Press return to send.")

                Button {
                    viewModel.sendKeyboardText()
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.wotannScaled(size: 18))
                        .foregroundColor(viewModel.keyboardText.isEmpty ? WTheme.Colors.textTertiary : WTheme.Colors.primary)
                }
                .disabled(viewModel.keyboardText.isEmpty)
                .accessibilityLabel("Send text")
                .accessibilityHint("Send the typed text to the remote desktop")
            }
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
        // T7.3 — Keyboard input bar Liquid Glass surface.
        .wLiquidGlass(in: Rectangle())
    }

    private var specialKeysRow: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            SpecialKeyButton(label: "Esc", key: "escape") {
                viewModel.sendSpecialKey("escape")
            }
            SpecialKeyButton(label: "Tab", key: "tab") {
                viewModel.sendSpecialKey("tab")
            }
            SpecialKeyButton(label: "Delete", key: "backspace") {
                viewModel.sendSpecialKey("backspace")
            }
            SpecialKeyButton(label: "Return", key: "return") {
                viewModel.sendSpecialKey("return")
            }

            Spacer()

            SpecialKeyButton(label: "Cmd", key: "command", isModifier: true) {
                viewModel.sendSpecialKey("command")
            }
            SpecialKeyButton(label: "Opt", key: "option", isModifier: true) {
                viewModel.sendSpecialKey("option")
            }
            SpecialKeyButton(label: "Ctrl", key: "control", isModifier: true) {
                viewModel.sendSpecialKey("control")
            }
        }
    }
}

// MARK: - SpecialKeyButton

/// A compact button for sending special keystrokes to the remote desktop.
private struct SpecialKeyButton: View {
    let label: String
    let key: String
    var isModifier: Bool = false
    let onTap: () -> Void

    var body: some View {
        Button {
            HapticService.shared.trigger(.buttonTap)
            onTap()
        } label: {
            Text(label)
                .font(WTheme.Typography.caption2)
                .fontWeight(.medium)
                .foregroundColor(isModifier ? WTheme.Colors.primary : WTheme.Colors.textPrimary)
                .padding(.horizontal, WTheme.Spacing.md)
                .frame(minHeight: 44)
                .background(isModifier ? WTheme.Colors.primary.opacity(0.1) : WTheme.Colors.surfaceAlt)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous)
                        .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label) key")
        .accessibilityHint("Send \(label) key to the remote desktop")
    }
}

// MARK: - Zoom Toolbar

private extension RemoteDesktopContent {

    var zoomToolbar: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            // Zoom presets
            ForEach(zoomPresets, id: \.label) { preset in
                Button {
                    withAnimation(WTheme.Animation.smooth) {
                        viewModel.zoomScale = preset.scale
                        viewModel.lastZoomScale = preset.scale
                    }
                    HapticService.shared.trigger(.buttonTap)
                } label: {
                    Text(preset.label)
                        .font(WTheme.Typography.caption2)
                        .fontWeight(abs(viewModel.zoomScale - preset.scale) < 0.1 ? .bold : .medium)
                        .foregroundColor(
                            abs(viewModel.zoomScale - preset.scale) < 0.1
                                ? WTheme.Colors.primary
                                : WTheme.Colors.textSecondary
                        )
                        .padding(.horizontal, WTheme.Spacing.sm)
                        .frame(minHeight: 32)
                        .background(
                            abs(viewModel.zoomScale - preset.scale) < 0.1
                                ? WTheme.Colors.primary.opacity(0.12)
                                : Color.clear
                        )
                        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))
                }
                .buttonStyle(.plain)
            }

            Spacer()

            // Current zoom percentage
            Text("\(Int(viewModel.zoomScale * 100))%")
                .font(.wotannScaled(size: 11, weight: .semibold, design: .monospaced))
                .foregroundColor(WTheme.Colors.textTertiary)
                .frame(width: 44)

            // Zoom out / in buttons
            Button {
                let newScale = max(viewModel.zoomScale - 0.5, 1.0)
                withAnimation(WTheme.Animation.smooth) {
                    viewModel.zoomScale = newScale
                    viewModel.lastZoomScale = newScale
                }
            } label: {
                Image(systemName: "minus.magnifyingglass")
                    .font(.wotannScaled(size: 14))
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .frame(width: 32, height: 32)
            }
            .disabled(viewModel.zoomScale <= 1.0)

            Button {
                let newScale = min(viewModel.zoomScale + 0.5, 5.0)
                withAnimation(WTheme.Animation.smooth) {
                    viewModel.zoomScale = newScale
                    viewModel.lastZoomScale = newScale
                }
            } label: {
                Image(systemName: "plus.magnifyingglass")
                    .font(.wotannScaled(size: 14))
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .frame(width: 32, height: 32)
            }
            .disabled(viewModel.zoomScale >= 5.0)
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.xs)
        // T7.3 — Zoom toolbar Liquid Glass surface.
        .wLiquidGlass(in: Rectangle())
    }

    var zoomPresets: [(label: String, scale: CGFloat)] {
        [
            ("Fit", 1.0),
            ("2x", 2.0),
            ("3x", 3.0),
        ]
    }
}

// MARK: - Quick Shortcuts Bar

private extension RemoteDesktopContent {

    var quickShortcutsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: WTheme.Spacing.sm) {
                ShortcutPill(icon: "doc.on.doc", label: "Copy", keys: "⌘C") {
                    viewModel.sendKeyCombo("command+c")
                }
                ShortcutPill(icon: "doc.on.clipboard", label: "Paste", keys: "⌘V") {
                    viewModel.sendKeyCombo("command+v")
                }
                ShortcutPill(icon: "arrow.uturn.backward", label: "Undo", keys: "⌘Z") {
                    viewModel.sendKeyCombo("command+z")
                }
                ShortcutPill(icon: "arrow.uturn.forward", label: "Redo", keys: "⇧⌘Z") {
                    viewModel.sendKeyCombo("shift+command+z")
                }
                ShortcutPill(icon: "selection.pin.in.out", label: "Select All", keys: "⌘A") {
                    viewModel.sendKeyCombo("command+a")
                }
                ShortcutPill(icon: "magnifyingglass", label: "Find", keys: "⌘F") {
                    viewModel.sendKeyCombo("command+f")
                }
                ShortcutPill(icon: "folder", label: "Save", keys: "⌘S") {
                    viewModel.sendKeyCombo("command+s")
                }
                ShortcutPill(icon: "arrow.left", label: "Back", keys: "⌘[") {
                    viewModel.sendKeyCombo("command+[")
                }
            }
            .padding(.horizontal, WTheme.Spacing.md)
        }
        .padding(.vertical, WTheme.Spacing.xs)
        // T7.3 — Quick shortcuts bar Liquid Glass surface.
        .wLiquidGlass(in: Rectangle())
    }
}

// MARK: - Minimap Overlay

private extension RemoteDesktopContent {

    var minimapOverlay: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                if let image = viewModel.screenImage {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 120)
                        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous)
                                .stroke(WTheme.Colors.primary.opacity(0.5), lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.4), radius: 8, x: 0, y: 4)
                        .opacity(0.85)
                        .padding(WTheme.Spacing.md)
                }
            }
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }
}

// MARK: - TapRippleView

/// Animated ripple effect at the point of tap, giving visual feedback for touches.
private struct TapRippleView: View {
    let at: CGPoint
    @State private var scale: CGFloat = 0.3
    @State private var opacity: Double = 0.8

    var body: some View {
        Circle()
            .fill(WTheme.Colors.primary.opacity(opacity))
            .frame(width: 24, height: 24)
            .scaleEffect(scale)
            .position(at)
            .onAppear {
                withAnimation(.easeOut(duration: 0.4)) {
                    scale = 1.5
                    opacity = 0
                }
            }
            .allowsHitTesting(false)
    }
}

// MARK: - ShortcutPill

/// A compact pill button for quick keyboard shortcuts.
private struct ShortcutPill: View {
    let icon: String
    let label: String
    let keys: String
    let action: () -> Void

    var body: some View {
        Button {
            HapticService.shared.trigger(.buttonTap)
            action()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.wotannScaled(size: 11))
                Text(label)
                    .font(.wotannScaled(size: 11, weight: .medium))
            }
            .foregroundColor(WTheme.Colors.textPrimary)
            .padding(.horizontal, WTheme.Spacing.sm)
            .frame(minHeight: 28)
            .background(WTheme.Colors.surfaceAlt)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label) (\(keys))")
    }
}

// MARK: - CaptureQuality

/// Resolution quality levels for screen capture.
enum CaptureQuality: String, CaseIterable, Identifiable {
    case low
    case medium
    case high

    var id: String { rawValue }

    var label: String {
        switch self {
        case .low:    return "Low"
        case .medium: return "Medium"
        case .high:   return "High"
        }
    }

    var scaleFactor: Double {
        switch self {
        case .low:    return 0.25
        case .medium: return 0.5
        case .high:   return 1.0
        }
    }
}

// MARK: - RemoteDesktopViewModel

@MainActor
final class RemoteDesktopViewModel: ObservableObject {
    @Published var screenImage: UIImage?
    @Published var screenWidth: Int = 1920
    @Published var screenHeight: Int = 1080
    @Published var isLoading = false
    @Published var isConnected = false
    @Published var errorMessage: String?
    @Published var quality: CaptureQuality = .medium
    @Published var showKeyboard = false
    @Published var keyboardText = ""
    @Published var zoomScale: CGFloat = 1.0
    @Published var frameRate: Double = 0.0

    /// Stores the zoom scale before the current pinch gesture started.
    var lastZoomScale: CGFloat = 1.0

    private var rpcClient: RPCClient?
    private var refreshTimer: Timer?
    private var frameCount = 0
    private var frameRateTimer: Timer?
    private var lastFrameTime: Date = .now

    // MARK: - Configuration

    func configure(rpcClient: RPCClient) {
        self.rpcClient = rpcClient
        isConnected = true
    }

    // MARK: - Touch Feedback

    /// Position of the last tap — shown as a ripple overlay.
    @Published var lastTapPoint: CGPoint?

    /// Whether the user is actively interacting (drives adaptive refresh rate).
    @Published var isInteracting = false
    private var interactionCooldown: Task<Void, Never>?

    /// Mark user activity — switches to fast refresh (0.5s).
    func markInteraction() {
        isInteracting = true
        interactionCooldown?.cancel()
        interactionCooldown = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000) // 3s cooldown
            await MainActor.run { self.isInteracting = false }
        }
    }

    // MARK: - Capture Lifecycle

    func startCapture() {
        isLoading = true
        captureScreen()
        startRefreshTimer()
        startFrameRateTracking()
    }

    func disconnect() {
        stopRefreshTimer()
        stopFrameRateTracking()
        isConnected = false
        screenImage = nil
    }

    // MARK: - Screen Capture

    /// Maximum number of retry attempts for a failed screen capture.
    private static let maxCaptureRetries = 2

    private func captureScreen() {
        guard let rpcClient else { return }

        Task {
            var lastError: Error?

            for attempt in 0...Self.maxCaptureRetries {
                do {
                    let params: [String: RPCValue] = [
                        "quality": .double(quality.scaleFactor),
                    ]
                    let response = try await rpcClient.send("screen.capture", params: params)
                    parseScreenCapture(response)
                    isLoading = false
                    errorMessage = nil
                    return
                } catch {
                    lastError = error
                    // Retry after a short delay unless this was the last attempt
                    if attempt < Self.maxCaptureRetries {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                    }
                }
            }

            isLoading = false
            errorMessage = "Capture failed: \(lastError?.localizedDescription ?? "Unknown error")"
        }
    }

    private func parseScreenCapture(_ response: RPCResponse) {
        guard case .object(let obj) = response.result else { return }

        if let base64 = obj["image"]?.stringValue,
           let imageData = Data(base64Encoded: base64) {
            // S4-24: downsample on the decode path so a 4K source shrinks to
            // a phone-friendly width before it ever reaches the render tree.
            if let image = Self.downsample(imageData: imageData, maxPixelWidth: Self.downsampleWidth) {
                screenImage = image
                recordFrame()
            } else if let image = UIImage(data: imageData) {
                // ImageIO decode should never fail on PNG, but retain the
                // direct-init fallback so a malformed response still renders.
                screenImage = image
                recordFrame()
            }
        }

        if let w = obj["width"]?.intValue ?? obj["width"]?.doubleValue.map({ Int($0) }) {
            screenWidth = w
        }
        if let h = obj["height"]?.intValue ?? obj["height"]?.doubleValue.map({ Int($0) }) {
            screenHeight = h
        }
    }

    // MARK: - Downsampling (S4-24)

    /// Maximum pixel width retained after downsampling. 1920 matches a standard
    /// 1080p source; a 4K (3840 px) capture lands at ~25% the pixel count
    /// which roughly quarters the decoded bitmap memory footprint.
    static let downsampleWidth: CGFloat = 1920

    private static let remoteDesktopLog = Logger(
        subsystem: "com.wotann.ios",
        category: "RemoteDesktop"
    )

    /// Decode `imageData` through ImageIO, applying a thumbnail-style downsample
    /// so the resulting bitmap never exceeds `maxPixelWidth`. This is cheaper
    /// than decoding a full 4K bitmap then resizing, because ImageIO can
    /// short-circuit the full decode when the largest requested dimension fits
    /// inside a preview.
    ///
    /// Returns a standard-scale `UIImage` so the SwiftUI rendering path does
    /// not upscale back to the screen scale — at 1920 px that is already well
    /// above what the phone display can resolve.
    static func downsample(imageData: Data, maxPixelWidth: CGFloat) -> UIImage? {
        let sourceOptions: [CFString: Any] = [
            kCGImageSourceShouldCache: false,
        ]
        guard let source = CGImageSourceCreateWithData(imageData as CFData, sourceOptions as CFDictionary) else {
            return nil
        }

        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelWidth,
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary) else {
            return nil
        }
        return UIImage(cgImage: cgImage, scale: 1.0, orientation: .up)
    }

    // MARK: - Refresh Timer

    /// Adaptive refresh: 0.5s during interaction, 3s when idle.
    private func startRefreshTimer() {
        stopRefreshTimer()
        let interval = isInteracting ? 0.5 : 3.0
        refreshTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.captureScreen()
                // Re-create timer if interaction state changed (rate needs adjustment)
                let expectedInterval = self.isInteracting ? 0.5 : 3.0
                if abs(expectedInterval - interval) > 0.1 {
                    self.startRefreshTimer()
                }
            }
        }
    }

    private func stopRefreshTimer() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    // MARK: - Frame Rate Tracking

    private func startFrameRateTracking() {
        frameCount = 0
        lastFrameTime = .now
        stopFrameRateTracking()
        frameRateTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let elapsed = Date.now.timeIntervalSince(self.lastFrameTime)
                if elapsed > 0 {
                    self.frameRate = Double(self.frameCount) / elapsed
                }
                self.frameCount = 0
                self.lastFrameTime = .now
            }
        }
    }

    private func stopFrameRateTracking() {
        frameRateTimer?.invalidate()
        frameRateTimer = nil
        frameRate = 0
    }

    private func recordFrame() {
        frameCount += 1
    }

    // MARK: - Mouse Input

    func sendClick(at point: CGPoint) {
        sendInputAction("click", x: point.x, y: point.y)
    }

    func sendDoubleClick(at point: CGPoint) {
        sendInputAction("doubleclick", x: point.x, y: point.y)
    }

    func sendRightClick(at point: CGPoint) {
        sendInputAction("rightclick", x: point.x, y: point.y)
    }

    func sendDrag(from start: CGPoint, to end: CGPoint) {
        sendInputAction("drag", x: start.x, y: start.y, endX: end.x, endY: end.y)
    }

    func sendScroll(at point: CGPoint, direction: String, amount: Int) {
        guard let rpcClient else { return }

        Task {
            do {
                _ = try await rpcClient.send("screen.input", params: [
                    "action": .string("scroll"),
                    "x": .double(Double(point.x)),
                    "y": .double(Double(point.y)),
                    "direction": .string(direction),
                    "amount": .double(Double(amount)),
                ])
            } catch {
                errorMessage = "Scroll failed: \(error.localizedDescription)"
            }
        }
    }

    private func sendInputAction(
        _ action: String,
        x: CGFloat,
        y: CGFloat,
        endX: CGFloat? = nil,
        endY: CGFloat? = nil
    ) {
        guard let rpcClient else { return }

        var params: [String: RPCValue] = [
            "action": .string(action),
            "x": .double(Double(x)),
            "y": .double(Double(y)),
        ]
        if let endX { params["endX"] = .double(Double(endX)) }
        if let endY { params["endY"] = .double(Double(endY)) }

        Task {
            do {
                _ = try await rpcClient.send("screen.input", params: params)
            } catch {
                errorMessage = "Input failed: \(error.localizedDescription)"
            }
        }
    }

    // MARK: - Keyboard Input

    func sendKeyboardText() {
        let text = keyboardText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let rpcClient else { return }

        let captured = text
        keyboardText = ""

        Task {
            do {
                _ = try await rpcClient.send("screen.keyboard", params: [
                    "text": .string(captured),
                ])
            } catch {
                errorMessage = "Keyboard input failed: \(error.localizedDescription)"
            }
        }
    }

    /// Send a key combo like "command+c", "shift+command+z", etc.
    func sendKeyCombo(_ combo: String) {
        guard let rpcClient else { return }
        markInteraction()

        Task {
            do {
                _ = try await rpcClient.send("screen.keyboard", params: [
                    "combo": .string(combo),
                ])
            } catch {
                errorMessage = "Key combo failed: \(error.localizedDescription)"
            }
        }
    }

    func sendSpecialKey(_ key: String) {
        guard let rpcClient else { return }

        Task {
            do {
                _ = try await rpcClient.send("screen.keyboard", params: [
                    "key": .string(key),
                ])
            } catch {
                errorMessage = "Key send failed: \(error.localizedDescription)"
            }
        }
    }
}

// MARK: - Previews

#Preview("Remote Desktop - Dark") {
    RemoteDesktopView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}

#Preview("Remote Desktop - Light") {
    RemoteDesktopView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.light)
}
