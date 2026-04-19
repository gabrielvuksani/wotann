import SwiftUI
@preconcurrency import AVFoundation
import UserNotifications

// MARK: - OnboardingView

/// Phase E redesign: exactly 3 screens. Welcome -> Permissions -> First Pairing.
/// Pure #000 canvas, Apple blue #0A84FF accent, 96pt glowing runic "W".
/// Persists completion to `@AppStorage("hasCompletedOnboarding")`.
struct OnboardingView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var currentPage = 0

    private let totalPages = 3

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Page content
                TabView(selection: $currentPage) {
                    WelcomeScreen(onContinue: advance)
                        .tag(0)

                    PermissionsScreen(
                        onContinue: advance,
                        onSkip: advance
                    )
                    .tag(1)

                    FirstPairingScreen(onComplete: finish)
                        .tag(2)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(WTheme.Animation.smooth, value: currentPage)

                // Page indicator
                PageDots(currentPage: currentPage, totalPages: totalPages)
                    .padding(.bottom, WTheme.Spacing.xl)
            }
        }
    }

    // MARK: - Navigation

    private func advance() {
        withAnimation(WTheme.Animation.smooth) {
            if currentPage < totalPages - 1 {
                currentPage += 1
            }
        }
    }

    private func finish() {
        withAnimation(WTheme.Animation.smooth) {
            hasCompletedOnboarding = true
        }
    }
}

// MARK: - PageDots

private struct PageDots: View {
    let currentPage: Int
    let totalPages: Int

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            ForEach(0..<totalPages, id: \.self) { index in
                Capsule()
                    .fill(
                        index == currentPage
                        ? WTheme.Colors.primary
                        : WTheme.Colors.textTertiary.opacity(0.3)
                    )
                    .frame(
                        width: index == currentPage ? 24 : 8,
                        height: 8
                    )
                    .animation(WTheme.Animation.bouncy, value: currentPage)
            }
        }
    }
}

// MARK: - Screen 1: Welcome

private struct WelcomeScreen: View {
    let onContinue: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        VStack(spacing: WTheme.Spacing.xl) {
            Spacer()

            // 96pt runic "W" glowing glyph
            Image(systemName: "w.square.fill")
                .font(.wotannScaled(size: 96, weight: .bold))
                .foregroundStyle(WTheme.Colors.primary)
                .shadow(color: WTheme.Colors.primary.opacity(0.7), radius: 30)
                .shadow(color: WTheme.Colors.primary.opacity(0.4), radius: 60)
                .scaleEffect(pulse ? 1.04 : 1.0)
                .animation(
                    reduceMotion
                    ? .linear(duration: 0)
                    : .easeInOut(duration: 1.8).repeatForever(autoreverses: true),
                    value: pulse
                )

            VStack(spacing: WTheme.Spacing.md) {
                // Title: 34pt rounded bold
                Text("WOTANN")
                    .font(.wotannScaled(size: 34, weight: .bold, design: .rounded))
                    .tracking(WTheme.Tracking.displayLarge)
                    .foregroundStyle(.white)

                // Tagline
                Text("The All-Father's companion for every model.")
                    .font(.wotannScaled(size: 17, weight: .regular, design: .rounded))
                    .foregroundStyle(WTheme.Colors.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, WTheme.Spacing.xl)
            }

            Spacer()

            // Continue button — 44pt primary blue
            Button(action: onContinue) {
                Text("Continue")
                    .font(.wotannScaled(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(WTheme.Colors.primary)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
            }
            .padding(.horizontal, WTheme.Spacing.xl)
            .padding(.bottom, WTheme.Spacing.lg)
        }
        .onAppear {
            if !reduceMotion { pulse = true }
        }
    }
}

// MARK: - Screen 2: Permissions

private struct PermissionsScreen: View {
    let onContinue: () -> Void
    let onSkip: () -> Void

    @State private var notificationsGranted: Bool?
    @State private var microphoneGranted: Bool?
    @State private var localNetworkTriggered = false

    var body: some View {
        VStack(spacing: WTheme.Spacing.lg) {
            Spacer()
                .frame(height: WTheme.Spacing.xl)

            VStack(spacing: WTheme.Spacing.sm) {
                Text("Quick Setup")
                    .font(.wotannScaled(size: 28, weight: .bold, design: .rounded))
                    .tracking(WTheme.Tracking.displaySmall)
                    .foregroundStyle(.white)

                Text("Grant access to unlock WOTANN's features.")
                    .font(.wotannScaled(size: 15, weight: .regular, design: .rounded))
                    .foregroundStyle(WTheme.Colors.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, WTheme.Spacing.xl)
            }

            Spacer()

            VStack(spacing: WTheme.Spacing.md) {
                PermissionRow(
                    icon: "bell.badge.fill",
                    title: "Notifications",
                    subtitle: "Task completions & approvals",
                    isGranted: notificationsGranted,
                    onEnable: requestNotifications
                )

                PermissionRow(
                    icon: "mic.fill",
                    title: "Microphone",
                    subtitle: "Push-to-talk voice commands",
                    isGranted: microphoneGranted,
                    onEnable: requestMicrophone
                )

                PermissionRow(
                    icon: "network",
                    title: "Local Network",
                    subtitle: "Discover your Mac automatically",
                    isGranted: localNetworkTriggered ? true : nil,
                    onEnable: triggerLocalNetwork
                )
            }
            .padding(.horizontal, WTheme.Spacing.lg)

            Spacer()

            Button(action: onContinue) {
                Text("Continue")
                    .font(.wotannScaled(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(WTheme.Colors.primary)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
            }
            .padding(.horizontal, WTheme.Spacing.xl)

            Button(action: onSkip) {
                Text("Skip for now")
                    .font(.wotannScaled(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(WTheme.Colors.textTertiary)
            }
            .padding(.bottom, WTheme.Spacing.lg)
        }
        .onAppear(perform: refreshStatuses)
    }

    // MARK: - Permission Requests

    private func requestNotifications() {
        Task {
            let granted = await NotificationService.shared.requestPermission()
            await MainActor.run {
                withAnimation(WTheme.Animation.bouncy) {
                    notificationsGranted = granted
                }
            }
        }
    }

    private func requestMicrophone() {
        Task {
            let status = AVCaptureDevice.authorizationStatus(for: .audio)
            let granted: Bool
            switch status {
            case .authorized:
                granted = true
            case .notDetermined:
                granted = await AVCaptureDevice.requestAccess(for: .audio)
            default:
                granted = false
            }
            await MainActor.run {
                withAnimation(WTheme.Animation.bouncy) {
                    microphoneGranted = granted
                }
            }
        }
    }

    /// Local Network has no explicit request API — a Bonjour browse triggers the
    /// system prompt. This is fired once; the state reflects that we've asked.
    private func triggerLocalNetwork() {
        guard !localNetworkTriggered else { return }
        localNetworkTriggered = true
        // Kick a short-lived Bonjour browse to surface the prompt.
        Task { @MainActor in
            let discovery = BonjourDiscovery()
            discovery.startDiscovery()
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            discovery.stopDiscovery()
        }
        withAnimation(WTheme.Animation.bouncy) { /* state already updated */ }
    }

    private func refreshStatuses() {
        // Notifications
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                switch settings.authorizationStatus {
                case .authorized, .provisional, .ephemeral:
                    notificationsGranted = true
                case .denied:
                    notificationsGranted = false
                default:
                    notificationsGranted = nil
                }
            }
        }

        // Microphone
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: microphoneGranted = true
        case .denied, .restricted: microphoneGranted = false
        default: microphoneGranted = nil
        }
    }
}

// MARK: - PermissionRow

private struct PermissionRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let isGranted: Bool?
    let onEnable: () -> Void

    var body: some View {
        HStack(spacing: WTheme.Spacing.md) {
            Image(systemName: icon)
                .font(.wotannScaled(size: 22, weight: .medium))
                .foregroundStyle(WTheme.Colors.primary)
                .frame(width: 44, height: 44)
                .background(WTheme.Colors.primary.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.wotannScaled(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)

                Text(subtitle)
                    .font(.wotannScaled(size: 13, weight: .regular, design: .rounded))
                    .foregroundStyle(WTheme.Colors.textTertiary)
                    .lineLimit(1)
            }

            Spacer()

            enableBadge
        }
        .padding(WTheme.Spacing.md)
        .frame(minHeight: 88)
        .background(Color(hex: 0x1C1C1E))
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
    }

    @ViewBuilder
    private var enableBadge: some View {
        switch isGranted {
        case .some(true):
            Image(systemName: "checkmark.circle.fill")
                .font(.title3)
                .foregroundStyle(WTheme.Colors.success)
                .frame(minHeight: 44)
                .transition(.scale.combined(with: .opacity))
        case .some(false):
            Text("Denied")
                .font(.wotannScaled(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(WTheme.Colors.textTertiary)
                .frame(minHeight: 44)
        case .none:
            Button(action: onEnable) {
                Text("Enable")
                    .font(.wotannScaled(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .frame(minHeight: 44)
                    .background(WTheme.Colors.primary)
                    .clipShape(Capsule())
            }
        }
    }
}

// MARK: - Screen 3: First Pairing

private struct FirstPairingScreen: View {
    let onComplete: () -> Void

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var connectionManager: ConnectionManager
    @State private var showWizard = false

    var body: some View {
        VStack(spacing: WTheme.Spacing.xl) {
            Spacer()

            Image(systemName: "link.circle.fill")
                .font(.wotannScaled(size: 80, weight: .regular))
                .foregroundStyle(WTheme.Colors.primary)
                .shadow(color: WTheme.Colors.primary.opacity(0.5), radius: 24)

            VStack(spacing: WTheme.Spacing.md) {
                Text("Link your Mac")
                    .font(.wotannScaled(size: 28, weight: .bold, design: .rounded))
                    .tracking(WTheme.Tracking.displaySmall)
                    .foregroundStyle(.white)

                Text("Pair WOTANN on your Mac to start commanding your AI agents.")
                    .font(.wotannScaled(size: 15, weight: .regular, design: .rounded))
                    .foregroundStyle(WTheme.Colors.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, WTheme.Spacing.xl)
            }

            Spacer()

            Button {
                showWizard = true
            } label: {
                Text("Start Pairing")
                    .font(.wotannScaled(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(WTheme.Colors.primary)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
            }
            .padding(.horizontal, WTheme.Spacing.xl)
            .padding(.bottom, WTheme.Spacing.lg)
        }
        .fullScreenCover(isPresented: $showWizard) {
            PairingWizardView(onComplete: {
                showWizard = false
                onComplete()
            })
            .environmentObject(appState)
            .environmentObject(connectionManager)
        }
    }
}

// MARK: - Previews

#Preview("Onboarding - Dark") {
    OnboardingView()
        .environmentObject(AppState())
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
