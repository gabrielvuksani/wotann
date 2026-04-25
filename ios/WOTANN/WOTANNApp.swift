import SwiftUI
import Combine
import UIKit
import WatchConnectivity

/// WOTANN iOS -- The All-Father's Companion.
/// Connects to your desktop WOTANN instance via encrypted WebSocket.
@main
struct WOTANNApp: App {
    /// V9 T14.3 — UIKit AppDelegate for APNs / PushKit callbacks.
    /// SwiftUI's lifecycle does not surface `application(
    /// _:didRegisterForRemoteNotificationsWithDeviceToken:)`, so we
    /// bridge through a UIApplicationDelegate that forwards each push
    /// callback to `NotificationService`.
    @UIApplicationDelegateAdaptor(WOTANNAppDelegate.self) private var appDelegate

    @StateObject private var appState = AppState()
    @StateObject private var connectionManager = ConnectionManager()
    @AppStorage("colorScheme") private var colorSchemePreference = "dark"
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @AppStorage("biometricLockEnabled") private var biometricLockEnabled = false
    @Environment(\.scenePhase) private var scenePhase

    /// iPhone-side WCSession delegate for Apple Watch communication.
    private let phoneWCDelegate = PhoneWCSessionDelegate()

    /// Biometric authentication state for app lock.
    @StateObject private var biometricAuth = BiometricAuth()
    @State private var isUnlocked = false

    /// V9 T7.6 — Per-process sting session id, set once at launch and used
    /// to gate the "play once per session on first unlock" rule. Re-deriving
    /// per launch (not per scene activation) means returning from background
    /// during the same process does NOT replay the cue.
    private let stingSessionId = UUID().uuidString

    /// Services wired at app startup.
    private let clipboardService = ClipboardService()
    private let localSendService = LocalSendService()
    @StateObject private var crossDeviceService = CrossDeviceService()
    @StateObject private var continuityCameraService = ContinuityCameraService()
    // S4-25: one process-wide OnDeviceModelService so per-view `@StateObject`
    // instantiations do not each allocate a config struct + OfflineQueueService.
    // Mounted on ContentView so every descendant reads it via
    // `@EnvironmentObject`.
    @StateObject private var onDeviceModelService = OnDeviceModelService()

    var body: some Scene {
        WindowGroup {
            Group {
                if biometricLockEnabled && !isUnlocked {
                    LockedView(biometricAuth: biometricAuth, onUnlock: { isUnlocked = true })
                } else if hasCompletedOnboarding {
                    ContentView()
                        .environmentObject(appState)
                        .environmentObject(connectionManager)
                        .environmentObject(crossDeviceService)
                        .environmentObject(continuityCameraService)
                        .environmentObject(onDeviceModelService)
                        .preferredColorScheme(resolvedColorScheme)
                        .tint(WTheme.Colors.primary)
                        // S4-13: clamp Dynamic Type bounds at the root. Dense
                        // UI surfaces rely on fixed call-site sizes (now
                        // wotannScaled) that already scale relative to the
                        // user's preferred category — this bound prevents
                        // the upper Accessibility Sizes from breaking layout.
                        .wotannDynamicType()
                        .onOpenURL { url in
                            handleDeepLink(url)
                        }
                        .sheet(isPresented: $appState.showMeetModeSheet) {
                            MeetModeView()
                                .environmentObject(appState)
                                .environmentObject(connectionManager)
                        }
                        .onAppear {
                            wireWatchConnectivity()
                            wireServices()
                        }
                        .onReceive(appState.$agents) { _ in
                            phoneWCDelegate.refreshCache(appState: appState, connectionManager: connectionManager)
                            appState.writeAgentStatusToSharedDefaults()
                        }
                        .onReceive(appState.$conversations) { _ in
                            phoneWCDelegate.refreshCache(appState: appState, connectionManager: connectionManager)
                            appState.writeRecentConversationsToSharedDefaults()
                        }
                        .onReceive(appState.$costSnapshot) { _ in
                            phoneWCDelegate.refreshCache(appState: appState, connectionManager: connectionManager)
                            appState.writeCostToSharedDefaults()
                        }
                        .onReceive(connectionManager.$isConnected) { connected in
                            if connected {
                                Task {
                                    await NodeCapabilityService.shared.registerCapabilities(with: connectionManager.rpcClient)
                                }
                            }
                        }
                        // Apply synced provider/model from desktop whenever they change
                        .onReceive(connectionManager.$syncedProvider) { provider in
                            if let provider, !provider.isEmpty {
                                appState.currentProvider = provider
                            }
                        }
                        .onReceive(connectionManager.$syncedModel) { model in
                            if let model, !model.isEmpty {
                                appState.currentModel = model
                            }
                        }
                } else {
                    OnboardingView()
                        .preferredColorScheme(resolvedColorScheme)
                        .tint(WTheme.Colors.primary)
                }
            }
            .onChange(of: scenePhase) { _, newPhase in
                handleScenePhaseChange(newPhase)
            }
            .task {
                // Load persisted conversations on launch
                let cached = ConversationStore.shared.loadConversations()
                if !cached.isEmpty && appState.conversations.isEmpty {
                    appState.conversations = cached
                }
            }
        }
    }

    // MARK: - Watch Connectivity Wiring

    private func wireWatchConnectivity() {
        phoneWCDelegate.appState = appState
        phoneWCDelegate.connectionManager = connectionManager
        // WCSession must always be activated — isPaired can only be checked AFTER
        // activation completes. The delegate handles the "not paired" state gracefully.
        // On simulator without a paired Watch, activation succeeds but isReachable = false,
        // which is the correct behavior.
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = phoneWCDelegate
        WCSession.default.activate()
    }

    // MARK: - Service Wiring

    private func wireServices() {
        clipboardService.startMonitoring()
        // LocalSend discovery is started on-demand from Settings, not at launch.
        // Starting it eagerly binds multicast 224.0.0.167:53317 and TCP :53318,
        // which fails with NECP address-in-use if the app relaunches quickly or
        // a second instance is running (e.g. simulator + device).
        connectionManager.autoDiscover()

        // Debug-only: if the test runner / fastlane passes
        // `WOTANN_DIAG_DUMP_AT_LAUNCH=1` we open the diagnostic share sheet
        // on launch so the log can be retrieved without manual user action.
        // This is strictly opt-in: default launches never trigger the sheet.
        // See `Tests/Infrastructure/DiagnosticLogger.swift` for the logger
        // implementation and `Tests/PhysicalDeviceTestChecklist.md` for the
        // intended usage.
        maybePresentDiagnosticDumpAtLaunch()
    }

    /// When `WOTANN_DIAG_DUMP_AT_LAUNCH=1` is set in the process environment,
    /// schedule a share of the diagnostic log shortly after launch. We delay
    /// so the SwiftUI scene has time to mount a root view controller for the
    /// share sheet to present on.
    ///
    /// Silently no-ops when the flag is unset OR when there is no log file
    /// yet (the logger writes a heartbeat inside `share()` to avoid a silent
    /// failure in that second case).
    private func maybePresentDiagnosticDumpAtLaunch() {
        guard ProcessInfo.processInfo.environment["WOTANN_DIAG_DUMP_AT_LAUNCH"] == "1" else {
            return
        }
        DiagnosticLogger.shared.log(
            feature: "diagnostic-logger",
            severity: .info,
            message: "WOTANN_DIAG_DUMP_AT_LAUNCH=1 — scheduling share on launch"
        )
        // 1.5 s is enough for the SwiftUI WindowGroup to finalise its root VC
        // even on cold starts with MLX warm-up still in flight.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            _ = DiagnosticLogger.shared.share()
        }
    }

    // MARK: - Scene Phase

    private func handleScenePhaseChange(_ phase: ScenePhase) {
        switch phase {
        case .background:
            ConversationStore.shared.saveConversations(appState.conversations)
            isUnlocked = false
        case .active:
            if biometricLockEnabled {
                // Re-lock was already handled by isUnlocked state
            }
            // V9 T7.6 — play the 6-note Wotann sting once per launch on
            // first scene activation, AFTER any biometric unlock has been
            // resolved (so the cue lands on the user's first sight of the
            // app, not on a locked screen they can't dismiss).
            if !biometricLockEnabled || isUnlocked {
                if #available(iOS 16.0, *) {
                    WotannStingService.shared.playIfFirstUnlock(sessionId: stingSessionId)
                }
            }
        default:
            break
        }
    }

    private var resolvedColorScheme: ColorScheme? {
        switch colorSchemePreference {
        case "dark": return .dark
        case "light": return .light
        default: return nil // follow system
        }
    }

    // MARK: - Deep Links

    /// Handle wotann:// URL scheme.
    ///
    /// Supported routes:
    /// - `wotann://pair?pin=ABC123&host=192.168.1.5&port=3849`
    /// - `wotann://chat?id=<UUID>`
    /// - `wotann://dispatch` -- switch to Dispatch tab
    /// - `wotann://meet` -- present Meet Mode sheet
    /// - `wotann://agent?id=<UUID>` -- navigate to agent detail
    /// - `wotann://settings` -- switch to Settings tab
    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "wotann" else { return }

        switch url.host {
        case "pair":
            handlePairLink(url)
        case "chat":
            handleChatLink(url)
        case "dispatch":
            // "Dispatch" now lives under the Work tab (index 2) in MainShell.
            appState.activeTab = 2
            appState.deepLinkDestination = "dispatch"
        case "meet":
            appState.showMeetModeSheet = true
        case "agent":
            handleAgentLink(url)
        case "settings":
            // "Settings" moved to the You tab (index 3) in MainShell.
            appState.activeTab = 3
        default:
            break
        }
    }

    private func handlePairLink(_ url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems else { return }

        let params = Dictionary(
            uniqueKeysWithValues: items.compactMap { item -> (String, String)? in
                guard let value = item.value else { return nil }
                return (item.name, value)
            }
        )

        guard let pin = params["pin"],
              let host = params["host"],
              let portStr = params["port"],
              let port = Int(portStr) else { return }

        let info = ConnectionManager.PairingInfo(
            id: params["id"] ?? UUID().uuidString,
            pin: pin,
            host: host,
            port: port
        )

        Task {
            try? await connectionManager.pair(with: info)
        }
    }

    private func handleChatLink(_ url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let idString = components.queryItems?.first(where: { $0.name == "id" })?.value,
              let uuid = UUID(uuidString: idString) else { return }

        appState.activeConversationId = uuid
    }

    private func handleAgentLink(_ url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let idString = components.queryItems?.first(where: { $0.name == "id" })?.value,
              let uuid = UUID(uuidString: idString) else { return }

        appState.activeTab = 2  // Agents tab
        appState.deepLinkAgentId = uuid
    }
}

// MARK: - ContentView

/// Root view: shows pairing if not connected, main tabs if paired.
struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager

    /// Determines whether to show the full app, offline view, or pairing.
    /// Three states:
    /// 1. Not paired → PairingView
    /// 2. Paired + connected (or forced offline) → MainTabView
    /// 3. Paired + disconnected → DaemonOfflineView
    private var shouldShowMainApp: Bool {
        connectionManager.isConnected ||
        connectionManager.connectionStatus == .relay ||
        connectionManager.forceOfflineMode
    }

    var body: some View {
        Group {
            if !connectionManager.isPaired {
                PairingView()
            } else if shouldShowMainApp {
                MainShell()
            } else {
                DaemonOfflineView()
            }
        }
        .animation(WTheme.Animation.smooth, value: connectionManager.isPaired)
        .animation(WTheme.Animation.smooth, value: shouldShowMainApp)
        .task {
            processPendingShares()
        }
    }

    // MARK: - Share Extension Queue

    /// Process shares queued by the Share Extension via the app group.
    private func processPendingShares() {
        guard let defaults = UserDefaults(suiteName: "group.com.wotann.shared") else { return }
        guard let queue = defaults.array(forKey: "pendingShares") as? [Data], !queue.isEmpty else { return }

        let decoder = JSONDecoder()

        for data in queue {
            guard let payload = try? decoder.decode([String: String].self, from: data),
                  let content = payload["content"], !content.isEmpty else { continue }

            let title = String(content.prefix(50))
            let conversation = Conversation(
                title: title,
                messages: [Message(role: .user, content: content)]
            )
            appState.addConversation(conversation)
        }

        // Clear the queue after processing
        defaults.removeObject(forKey: "pendingShares")
    }
}

// MARK: - MainTabView

/// Primary tab navigation after pairing.
struct MainTabView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager

    var body: some View {
        TabView(selection: $appState.activeTab) {
            DashboardView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }
                .tag(0)

            ConversationListView()
                .tabItem {
                    Label("Chat", systemImage: "bubble.left.and.bubble.right.fill")
                }
                .tag(1)

            AgentListView()
                .tabItem {
                    Label("Agents", systemImage: "square.grid.2x2.fill")
                }
                .tag(2)
                .badge(appState.activeAgents.count > 0 ? "\(appState.activeAgents.count)" : nil)

            ArenaView()
                .tabItem {
                    Label("Compare", systemImage: "rectangle.split.2x1")
                }
                .tag(3)

            SettingsView()
                .tabItem {
                    Label("More", systemImage: "ellipsis.circle.fill")
                }
                .tag(4)
        }
        .tint(WTheme.Colors.primary)
        .task {
            await appState.syncFromDesktop(using: connectionManager.rpcClient)
        }
    }
}

// MARK: - LockedView

/// Biometric lock screen shown when the app requires authentication.
struct LockedView: View {
    @ObservedObject var biometricAuth: BiometricAuth
    let onUnlock: () -> Void

    var body: some View {
        ZStack {
            WTheme.Colors.background.ignoresSafeArea()

            VStack(spacing: WTheme.Spacing.xl) {
                Image(systemName: "lock.shield.fill")
                    .font(.wotannScaled(size: 64))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [WTheme.Colors.primary, .wotannCyan],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )

                Text("WOTANN is Locked")
                    .font(WTheme.Typography.title2)
                    .foregroundColor(WTheme.Colors.textPrimary)

                Text("Authenticate to continue")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textSecondary)

                if let error = biometricAuth.error {
                    Text(error)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.error)
                }

                Button {
                    Task {
                        let success = await biometricAuth.authenticate(reason: "Unlock WOTANN")
                        if success { onUnlock() }
                    }
                } label: {
                    HStack(spacing: WTheme.Spacing.sm) {
                        Image(systemName: biometricAuth.biometryType == .faceID ? "faceid" : "touchid")
                        Text("Unlock with \(biometricAuth.biometryName)")
                            .font(WTheme.Typography.headline)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .padding(.vertical, WTheme.Spacing.md)
                    .background(WTheme.Colors.primary)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                }
                .padding(.horizontal, WTheme.Spacing.xl)
            }
        }
        .onAppear {
            Task {
                let success = await biometricAuth.authenticate(reason: "Unlock WOTANN")
                if success { onUnlock() }
            }
        }
    }
}

// MARK: - PhoneWCSessionDelegate

/// iPhone-side WCSession delegate that responds to Apple Watch requests.
///
/// The Watch app sends messages expecting replies for:
/// - "getAgents" -- returns the current agent list
/// - "getCost" -- returns today's cost snapshot
/// - "quickAction" -- forwards a quick action to the desktop
/// - "requestUpdate" -- returns a full status snapshot
///
/// WCSession callbacks arrive on a serial background queue, so we cache
/// nonisolated snapshots that can be read without crossing actor boundaries.
final class PhoneWCSessionDelegate: NSObject, WCSessionDelegate {

    /// Shared singleton used to inject AppState after creation.
    private(set) static var shared: PhoneWCSessionDelegate?

    /// Weak reference to AppState for forwarding side-effect actions.
    weak var appState: AppState?

    /// Weak reference to ConnectionManager for forwarding actions.
    weak var connectionManager: ConnectionManager?

    // Nonisolated cached snapshots -- updated from the main actor via `refreshCache()`.
    private var cachedAgentCount: Int = 0
    private var cachedAgents: [[String: Any]] = []
    private var cachedTodayCost: Double = 0
    private var cachedIsConnected: Bool = false

    override init() {
        super.init()
        Self.shared = self
        // WCSession activation is performed in WOTANNApp.wireWatchConnectivity()
        // after appState and connectionManager refs are assigned.
    }

    /// Call from the main actor whenever agents/cost/connection state changes
    /// to keep the nonisolated cache fresh.
    @MainActor
    func refreshCache(appState: AppState, connectionManager: ConnectionManager) {
        let agents = appState.agents
        cachedAgentCount = agents.filter { $0.status.isActive }.count
        cachedAgents = agents.map { agent in
            [
                "name": agent.title,
                "status": agent.status.rawValue,
                "progress": agent.progress,
                "cost": agent.cost,
            ] as [String: Any]
        }
        cachedTodayCost = appState.costSnapshot.todayTotal
        cachedIsConnected = connectionManager.isConnected
    }

    // MARK: - WCSessionDelegate Required

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        // No-op; we respond to messages on demand.
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        // Re-activate for device switching (e.g. multiple paired watches).
        WCSession.default.activate()
    }

    // MARK: - Message Handling

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let action = message["action"] as? String ?? ""
        let reply = buildReply(for: action)
        replyHandler(reply)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        // Fire-and-forget messages -- still process the action.
        let action = message["action"] as? String ?? ""
        handleSideEffect(for: action)
    }

    // MARK: - Reply Builder

    private func buildReply(for action: String) -> [String: Any] {
        switch action {
        case "getAgents":
            return ["agentCount": cachedAgentCount, "agents": cachedAgents]
        case "getCost":
            return ["todayCost": cachedTodayCost]
        case "requestUpdate":
            return [
                "agentCount": cachedAgentCount,
                "agents": cachedAgents,
                "todayCost": cachedTodayCost,
                "isDesktopConnected": cachedIsConnected,
            ]
        case "quickAction", "approveAll", "killAll", "runTests", "voiceInput":
            handleSideEffect(for: action)
            return ["status": "dispatched"]
        default:
            return ["status": "unknown_action"]
        }
    }

    private func handleSideEffect(for action: String) {
        // Forward certain watch actions to the desktop via RPC on the main actor.
        Task { @MainActor [weak self] in
            guard let self, let rpc = self.connectionManager?.rpcClient else { return }
            switch action {
            case "approveAll":
                for agent in self.appState?.activeAgents ?? [] {
                    try? await rpc.approveAction(taskId: agent.id)
                }
            case "killAll":
                for agent in self.appState?.activeAgents ?? [] {
                    try? await rpc.cancelTask(taskId: agent.id)
                }
            case "runTests":
                _ = try? await rpc.send("quickAction", params: ["action": .string("runTests")])
            case "voiceInput":
                _ = try? await rpc.send("quickAction", params: ["action": .string("voiceInput")])
            default:
                break
            }
        }
    }
}

// MARK: - WOTANNAppDelegate (V9 T14.3 APNs registration)

/// UIKit `AppDelegate` bridge for push-notification callbacks that
/// SwiftUI's `App` lifecycle does not surface. This delegate is wired
/// to the SwiftUI `App` via `@UIApplicationDelegateAdaptor` and
/// forwards each push-related callback to `NotificationService`.
///
/// Per Apple's contract, the device-token callbacks fire on the main
/// thread; `NotificationService` is `@MainActor`, so the forward is a
/// direct method call. We also kick off `registerForRemoteNotifications`
/// in `application(_:didFinishLaunchingWithOptions:)` so the app
/// requests its APNs token at launch — the user-facing permission
/// prompt is owned by `NotificationService.requestPermission()` and
/// happens at a more deliberate moment in the onboarding flow.
final class WOTANNAppDelegate: NSObject, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Honest stub: registering for remote notifications without
        // the APNs entitlement does not crash — iOS will simply call
        // `didFailToRegisterForRemoteNotificationsWithError`. We
        // still kick it off so simulator builds without an APNs
        // sandbox certificate exercise the failure-handling path.
        Task { @MainActor in
            NotificationService.shared.registerForRemoteNotifications()
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            NotificationService.shared.handleAPNsToken(deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            NotificationService.shared.handleAPNsRegistrationFailure(error)
        }
    }

    /// Handle remote notifications delivered while the app is
    /// foregrounded or in the background. The completion handler
    /// signals the system that we've finished any background work
    /// triggered by the push.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        Task { @MainActor in
            NotificationService.shared.handleRemoteNotification(userInfo: userInfo)
            completionHandler(.newData)
        }
    }
}
