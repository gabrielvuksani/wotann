import SwiftUI

// MARK: - SettingsView

/// All app settings panels.
struct SettingsView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @EnvironmentObject var appState: AppState
    @AppStorage("biometricLockEnabled") private var biometricLock = false
    @AppStorage("autoConnectEnabled") private var autoConnect = true
    @AppStorage("notificationsEnabled") private var notifications = true
    @AppStorage("hapticFeedback") private var hapticFeedback = true
    // V9 T14.4 — opt-in barge-in voice mode. When ON the voice surface
    // activates `DuplexVoiceSession` in parallel with the regular recording
    // path so the user can interrupt the assistant.
    @AppStorage("voiceBargeInEnabled") private var voiceBargeIn = false
    @State private var showUnpairAlert = false
    @State private var showDispatchFromDeepLink = false
    @State private var healthKitService = HealthKitService()
    @State private var localSendService = LocalSendService()
    // PHASE C — GDPR + Trust UI state
    @State private var gdprExportMessage: String?
    @State private var gdprDeleteConfirmShowing = false

    var body: some View {
        NavigationStack {
            List {
                connectionSection
                relaySection
                toolsSection
                healthInsightsSection
                fileSharingSection
                appearanceSection
                voiceSection
                privacySection
                notificationSection
                dataSection
                aboutSection
                unpairSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
            .navigationTitle("Settings")
            .navigationDestination(isPresented: $showDispatchFromDeepLink) {
                DispatchView()
            }
            .onAppear {
                if appState.deepLinkDestination == "dispatch" {
                    appState.deepLinkDestination = nil
                    showDispatchFromDeepLink = true
                }
            }
            .alert("Unpair Device?", isPresented: $showUnpairAlert) {
                Button("Unpair", role: .destructive) {
                    connectionManager.unpair()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will disconnect from your desktop and remove all pairing data.")
            }
        }
    }

    // MARK: - Sections

    private var connectionSection: some View {
        Section {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: connectionManager.isConnected ? "wifi" : "wifi.slash")
                    .foregroundColor(connectionManager.isConnected ? WTheme.Colors.success : WTheme.Colors.error)
                    .frame(width: WTheme.IconSize.md)
                Text(connectionManager.connectionStatus.rawValue)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Spacer()
                // Status glow dot
                Circle()
                    .fill(connectionManager.isConnected ? WTheme.Colors.success : WTheme.Colors.error)
                    .frame(width: 8, height: 8)
                    .shadow(
                        color: connectionManager.isConnected
                            ? WTheme.Colors.success.opacity(0.5)
                            : WTheme.Colors.error.opacity(0.5),
                        radius: 4, x: 0, y: 0
                    )
                    .animation(WTheme.Animation.smooth, value: connectionManager.isConnected)
            }

            if let device = connectionManager.pairedDevice {
                LabeledContent("Desktop") {
                    Text(device.name)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
                LabeledContent("Host") {
                    Text("\(device.host):\(device.port)")
                        .font(WTheme.Typography.code)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
                LabeledContent("Paired") {
                    Text(device.pairedAt, style: .date)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
                HStack {
                    Label("Security", systemImage: connectionManager.isEncrypted ? "lock.fill" : "lock.open.fill")
                    Spacer()
                    Text(connectionManager.connectionSecurity.rawValue)
                        .foregroundColor(connectionManager.isEncrypted ? WTheme.Colors.success : WTheme.Colors.warning)
                        .font(WTheme.Typography.caption)
                }

                if let warning = connectionManager.encryptionWarning {
                    HStack(spacing: WTheme.Spacing.sm) {
                        Image(systemName: "exclamationmark.shield.fill")
                            .foregroundColor(WTheme.Colors.warning)
                        Text(warning)
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.warning)
                    }
                    .padding(.vertical, WTheme.Spacing.xs)
                }
            }

            Toggle("Auto-connect when nearby", isOn: $autoConnect)
                .tint(WTheme.Colors.primary)
                .accessibilityLabel("Auto-connect when nearby")
                .accessibilityHint("Automatically connect to your desktop when on the same network")
        } header: {
            Text("Connection")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Remote Bridge (Supabase)

    @AppStorage("supabaseUrl") private var supabaseUrl = ""
    @AppStorage("supabaseKey") private var supabaseKey = ""

    private var relaySection: some View {
        Section {
            VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                Text("Remote bridge allows access from anywhere, not just your local WiFi.")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }

            LabeledContent("Supabase Project URL") {
                TextField("https://your-project.supabase.co", text: $supabaseUrl)
                    .font(WTheme.Typography.code)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .multilineTextAlignment(.trailing)
            }

            LabeledContent("Anon Key") {
                SecureField("sb_...", text: $supabaseKey)
                    .font(WTheme.Typography.code)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .multilineTextAlignment(.trailing)
            }

            if !supabaseUrl.isEmpty && !supabaseKey.isEmpty {
                Button {
                    // Apply the custom Supabase config to the relay
                    let config = RelayConfig(
                        supabaseUrl: supabaseUrl,
                        supabaseAnonKey: supabaseKey,
                        channelId: UUID().uuidString,
                        devicePairId: connectionManager.pairedDevice?.id ?? "manual"
                    )
                    connectionManager.supabaseRelay.saveConfig(config)
                    HapticService.shared.trigger(.taskComplete)
                } label: {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(WTheme.Colors.success)
                        Text("Apply Bridge Config")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.success)
                    }
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text("Remote Bridge")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        } footer: {
            Text("Free tier at supabase.com. Create a project and paste the URL + anon key above.")
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var toolsSection: some View {
        Section {
            NavigationLink {
                IntelligenceDashboardView()
            } label: {
                Label("Intelligence", systemImage: "brain.head.profile.fill")
            }

            NavigationLink {
                MemoryBrowserView()
            } label: {
                Label("Memory", systemImage: "brain.head.profile")
            }

            NavigationLink {
                BlocksView()
            } label: {
                Label("Memory Blocks", systemImage: "rectangle.stack.fill")
            }

            NavigationLink {
                OperationsView()
            } label: {
                Label("Operations", systemImage: "gearshape.fill")
            }

            NavigationLink {
                TeamsView()
            } label: {
                Label("Teams", systemImage: "person.3.fill")
            }

            NavigationLink {
                SkillsBrowserView()
            } label: {
                Label("Skills", systemImage: "sparkles")
            }

            NavigationLink {
                ChannelStatusView()
            } label: {
                Label("Channels", systemImage: "bubble.left.and.bubble.right")
            }

            NavigationLink {
                PairedDevicesView()
            } label: {
                Label("Paired Devices", systemImage: "desktopcomputer")
            }

            NavigationLink {
                ProviderSettings()
            } label: {
                Label("Providers", systemImage: "server.rack")
            }

            NavigationLink {
                DispatchView()
            } label: {
                Label("Dispatch Inbox", systemImage: "paperplane.fill")
            }

            NavigationLink {
                CostDashboardView()
            } label: {
                Label("Cost Dashboard", systemImage: "chart.bar.fill")
            }

            NavigationLink {
                AutopilotView()
            } label: {
                Label("Autopilot", systemImage: "bolt.circle.fill")
            }

            NavigationLink {
                WorkflowsView()
            } label: {
                Label("Workflows", systemImage: "arrow.triangle.branch")
            }

            NavigationLink {
                FileSearchView()
            } label: {
                Label("File Search", systemImage: "doc.text.magnifyingglass")
            }

            NavigationLink {
                DiagnosticsView()
            } label: {
                Label("Diagnostics", systemImage: "stethoscope")
            }

            NavigationLink {
                OnDeviceAIView()
            } label: {
                Label("On-Device AI", systemImage: "cpu.fill")
            }
        } header: {
            Text("Tools & Services")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Health Insights

    private var healthInsightsSection: some View {
        Section {
            NavigationLink {
                HealthInsightsSettingsView(healthKitService: healthKitService)
            } label: {
                HStack(spacing: WTheme.Spacing.sm) {
                    Label("Health Insights", systemImage: "heart.text.square.fill")
                    Spacer()
                    if healthKitService.isAuthorized {
                        Text("\(healthKitService.insights.count) insights")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    } else {
                        Text("Not Connected")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                }
            }
        } header: {
            Text("Health Insights")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        } footer: {
            Text("Correlate HealthKit data with coding sessions for productivity insights.")
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - File Sharing (LocalSend)

    private var fileSharingSection: some View {
        Section {
            Toggle(isOn: Binding(
                get: { localSendService.isDiscovering },
                set: { newValue in
                    if newValue {
                        localSendService.startDiscovery()
                    } else {
                        localSendService.stopDiscovery()
                    }
                }
            )) {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .foregroundColor(WTheme.Colors.primary)
                        .frame(width: WTheme.IconSize.md)
                    Text("LocalSend Discovery")
                }
            }
            .tint(WTheme.Colors.primary)
            .accessibilityLabel("LocalSend Discovery")
            .accessibilityHint("Enable local network file sharing via LocalSend protocol")

            if localSendService.isDiscovering {
                if localSendService.discoveredPeers.isEmpty {
                    HStack(spacing: WTheme.Spacing.sm) {
                        ProgressView()
                            .scaleEffect(0.8)
                        Text("Scanning for nearby devices...")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                } else {
                    ForEach(localSendService.discoveredPeers) { peer in
                        HStack(spacing: WTheme.Spacing.sm) {
                            Image(systemName: peerIcon(for: peer.deviceType))
                                .foregroundColor(WTheme.Colors.primary)
                                .frame(width: WTheme.IconSize.md)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(peer.name)
                                    .font(WTheme.Typography.subheadline)
                                    .foregroundColor(WTheme.Colors.textPrimary)
                                Text("\(peer.host):\(peer.port)")
                                    .font(WTheme.Typography.caption2)
                                    .foregroundColor(WTheme.Colors.textTertiary)
                            }
                            Spacer()
                            Circle()
                                .fill(WTheme.Colors.success)
                                .frame(width: 8, height: 8)
                                .shadow(
                                    color: WTheme.Colors.success.opacity(0.5),
                                    radius: 4, x: 0, y: 0
                                )
                        }
                    }
                }
            }

            if let error = localSendService.error {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(WTheme.Colors.warning)
                    Text(error.localizedDescription)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.warning)
                }
            }
        } header: {
            Text("File Sharing")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        } footer: {
            Text("Share files with nearby devices using the LocalSend protocol. Received files are injected into the active conversation.")
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private func peerIcon(for deviceType: String) -> String {
        switch deviceType {
        case "phone":   return "iphone"
        case "tablet":  return "ipad"
        case "desktop": return "desktopcomputer"
        case "laptop":  return "laptopcomputer"
        default:        return "externaldrive.connected.to.line.below"
        }
    }

    @AppStorage("colorScheme") private var colorSchemePreference = "dark"

    private var appearanceSection: some View {
        Section {
            NavigationLink {
                AppearanceSettings()
            } label: {
                HStack {
                    Label("Theme & Display", systemImage: "paintbrush.fill")
                    Spacer()
                    Text(colorSchemePreference.capitalized)
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            }
        } header: {
            Text("Appearance")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var voiceSection: some View {
        // V9 T14.4 — Voice settings. Currently exposes the opt-in barge-in
        // toggle. Off by default — duplex audio uses the heavier
        // `.playAndRecord` AV session category which ducks other audio,
        // so users who want it enable it explicitly.
        Section {
            Toggle(isOn: $voiceBargeIn) {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "waveform.and.mic")
                        .foregroundColor(WTheme.Colors.primary)
                        .frame(width: WTheme.IconSize.md)
                    VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                        Text("Enable barge-in")
                        Text("Let WOTANN listen while it speaks so you can interrupt mid-reply.")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                }
            }
            .tint(WTheme.Colors.primary)
            .accessibilityLabel("Enable barge-in voice mode")
            .accessibilityHint("When on, the voice input session keeps listening while the assistant speaks so you can interrupt it.")
        } header: {
            Text("Voice")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var privacySection: some View {
        Section {
            Toggle(isOn: $biometricLock) {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "faceid")
                        .foregroundColor(WTheme.Colors.primary)
                        .frame(width: WTheme.IconSize.md)
                    Text("Face ID / Touch ID Lock")
                }
            }
            .tint(WTheme.Colors.primary)
            .accessibilityLabel("Face ID or Touch ID Lock")
            .accessibilityHint("Require biometric authentication to open the app")

            Toggle(isOn: $hapticFeedback) {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "hand.tap.fill")
                        .foregroundColor(WTheme.Colors.primary)
                        .frame(width: WTheme.IconSize.md)
                    Text("Haptic Feedback")
                }
            }
            .tint(WTheme.Colors.primary)
            .accessibilityLabel("Haptic Feedback")
            .accessibilityHint("Enable or disable vibration feedback for interactions")
        } header: {
            Text("Privacy & Security")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var notificationSection: some View {
        Section {
            NavigationLink {
                NotificationSettings()
            } label: {
                HStack {
                    Label("Notification Preferences", systemImage: "bell.fill")
                    Spacer()
                    Text(notifications ? "On" : "Off")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            }
        } header: {
            Text("Notifications")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var dataSection: some View {
        Section {
            Button {
                ConversationStore.shared.clearAll()
                HapticService.shared.trigger(.buttonTap)
            } label: {
                Label("Clear Conversation Cache", systemImage: "trash")
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .frame(minHeight: 44)
            }
            .accessibilityLabel("Clear Conversation Cache")
            .accessibilityHint("Delete all cached conversation data from this device")

            LabeledContent("Cache Size") {
                Text(cacheSize)
                    .font(.wotannScaled(size: 14, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textSecondary)
            }

            // PHASE C — GDPR Article 20 (Data Portability) — calls daemon
            // gdpr.export RPC which bundles ~/.wotann into a tar.gz on the
            // paired desktop and reports the artifact path. App Store
            // expects this entry to be reachable from inside the app.
            Button {
                Task { @MainActor in
                    do {
                        let response = try await connectionManager.rpcClient.send(
                            "gdpr.export", params: [:]
                        )
                        if let path = response.result?.objectValue?["path"]?.stringValue {
                            gdprExportMessage = "Exported to: \(path)"
                        } else {
                            gdprExportMessage = "Export failed — check daemon logs"
                        }
                    } catch {
                        gdprExportMessage = "Error: \(error.localizedDescription)"
                    }
                }
                HapticService.shared.trigger(.buttonTap)
            } label: {
                Label("Export My Data (GDPR Article 20)", systemImage: "square.and.arrow.up.on.square")
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .frame(minHeight: 44)
            }
            if let msg = gdprExportMessage {
                Text(msg)
                    .font(.wotannScaled(size: 12))
                    .foregroundColor(WTheme.Colors.textSecondary)
            }

            // PHASE C — GDPR Article 17 (Right to Erasure) — destructive.
            Button(role: .destructive) {
                gdprDeleteConfirmShowing = true
            } label: {
                Label("Delete Everything (GDPR Article 17)", systemImage: "trash.slash")
                    .frame(minHeight: 44)
            }
            .alert("Delete all WOTANN data?", isPresented: $gdprDeleteConfirmShowing) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    Task { @MainActor in
                        do {
                            let response = try await connectionManager.rpcClient.send(
                                "gdpr.delete", params: ["confirm": .bool(true)]
                            )
                            if response.result?.objectValue?["ok"]?.boolValue == true {
                                gdprExportMessage = "Deleted: ~/.wotann"
                                ConversationStore.shared.clearAll()
                            } else {
                                gdprExportMessage = "Delete failed — check daemon logs"
                            }
                        } catch {
                            gdprExportMessage = "Error: \(error.localizedDescription)"
                        }
                    }
                }
            } message: {
                Text("Removes ~/.wotann (memory, cache, credentials) on the paired desktop. No recovery. Run Export first if you want a backup.")
            }

            // PHASE C — Workspace Trust (SB-N1 lift to UI surface).
            NavigationLink {
                WorkspaceTrustView()
                    .environmentObject(connectionManager)
            } label: {
                Label("Trusted Workspaces", systemImage: "checkmark.shield")
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .frame(minHeight: 44)
            }

            // v9 cross-surface parity: TUI/CLI/macOS all have MCP server
            // management; iOS was the only surface missing it.
            NavigationLink {
                MCPListView()
                    .environmentObject(connectionManager)
            } label: {
                Label("MCP Servers", systemImage: "server.rack")
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .frame(minHeight: 44)
            }

            // Cron + Schedule cross-surface parity (TUI /schedule + CLI
            // wotann cron/schedule). Combined view with tab switcher.
            NavigationLink {
                ScheduleView()
                    .environmentObject(connectionManager)
            } label: {
                Label("Scheduled Tasks", systemImage: "clock.badge")
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .frame(minHeight: 44)
            }

            // H-E15: dead-letter queue surface so users can inspect
            // tasks that exhausted their retry budget. Without this UI
            // the DLQ accumulated silently on disk.
            NavigationLink {
                OfflineQueueDLQView()
            } label: {
                Label("Dead Letter Queue", systemImage: "tray.full")
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .frame(minHeight: 44)
            }
        } header: {
            Text("Data")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var aboutSection: some View {
        Section {
            NavigationLink {
                AboutView()
            } label: {
                Label("About WOTANN", systemImage: "info.circle")
            }

            LabeledContent("Version") {
                Text(appVersionString)
                    .font(.wotannScaled(size: 14, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
        } header: {
            Text("About")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var unpairSection: some View {
        Section {
            Button(role: .destructive) {
                showUnpairAlert = true
            } label: {
                HStack {
                    Spacer()
                    Text("Unpair This Device")
                        .font(WTheme.Typography.body)
                        .fontWeight(.semibold)
                    Spacer()
                }
                .frame(minHeight: 44)
            }
            .accessibilityLabel("Unpair This Device")
            .accessibilityHint("Disconnect from your desktop and remove all pairing data")
        }
        .listRowBackground(WTheme.Colors.error.opacity(0.1))
    }

    private var appVersionString: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    private var cacheSize: String {
        let bytes = ConversationStore.shared.approximateSize()
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
