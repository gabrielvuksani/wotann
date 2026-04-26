import SwiftUI
import WatchConnectivity

// MARK: - WOTANN Watch App

/// Apple Watch companion — agent triage, cost display, quick actions.
@main
struct WOTANNWatchApp: App {
    @StateObject private var sessionDelegate = PhoneSessionDelegate()

    var body: some Scene {
        WindowGroup {
            WatchHomeView()
                .environmentObject(sessionDelegate)
        }
    }
}

// MARK: - PhoneSessionDelegate

/// Manages WCSession communication with the paired iPhone app.
final class PhoneSessionDelegate: NSObject, ObservableObject, WCSessionDelegate {
    @Published var agentCount: Int = 0
    @Published var todayCost: Double = 0
    @Published var isPhoneConnected: Bool = false
    @Published var isDesktopConnected: Bool = false
    @Published var agents: [WatchAgent] = []
    @Published var lastError: String?

    private var session: WCSession?

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        session = WCSession.default
        session?.delegate = self
        session?.activate()
    }

    // MARK: - WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async {
            self.isPhoneConnected = activationState == .activated && session.isReachable
            if activationState == .activated {
                self.requestUpdate()
            }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isPhoneConnected = session.isReachable
            if session.isReachable {
                self.requestUpdate()
            }
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async {
            self.handleUpdate(message)
        }
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        DispatchQueue.main.async {
            self.handleUpdate(message)
        }
        replyHandler(["status": "received"])
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            self.handleUpdate(applicationContext)
        }
    }

    // MARK: - Data Handling

    private func handleUpdate(_ data: [String: Any]) {
        if let count = data["agentCount"] as? Int {
            agentCount = count
        }
        if let cost = data["todayCost"] as? Double {
            todayCost = cost
        }
        if let connected = data["isDesktopConnected"] as? Bool {
            isDesktopConnected = connected
        }
        if let agentData = data["agents"] as? [[String: Any]] {
            agents = agentData.map { dict in
                WatchAgent(
                    name: dict["name"] as? String ?? "Unknown",
                    status: dict["status"] as? String ?? "idle",
                    progress: dict["progress"] as? Double ?? 0,
                    cost: dict["cost"] as? Double ?? 0
                )
            }
        }
    }

    // MARK: - Requests to Phone

    func requestUpdate() {
        sendToPhone(["action": "requestUpdate"])
    }

    func sendQuickAction(_ action: String) {
        sendToPhone(["action": action])
    }

    func approveAll() {
        sendToPhone(["action": "approveAll"])
    }

    func killAll() {
        sendToPhone(["action": "killAll"])
    }

    private func sendToPhone(_ message: [String: Any]) {
        guard let session, session.isReachable else {
            lastError = "iPhone not reachable"
            return
        }
        session.sendMessage(message, replyHandler: { [weak self] reply in
            DispatchQueue.main.async {
                self?.handleUpdate(reply)
            }
        }, errorHandler: { [weak self] error in
            DispatchQueue.main.async {
                self?.lastError = error.localizedDescription
            }
        })
    }
}

// MARK: - WatchAgent

struct WatchAgent: Identifiable {
    let id = UUID()
    let name: String
    let status: String
    let progress: Double
    let cost: Double

    var isRunning: Bool { status == "running" }
    var statusColor: Color {
        switch status {
        case "running": return WatchColors.primary       // indigo-500
        case "completed": return WatchColors.success     // emerald-500
        case "failed": return WatchColors.error          // rose-500
        default: return WatchColors.warning              // amber-500
        }
    }
}

// MARK: - Watch Home View

struct WatchHomeView: View {
    @EnvironmentObject var phoneSession: PhoneSessionDelegate

    var body: some View {
        NavigationStack {
            List {
                // Connection status
                Section {
                    HStack {
                        Circle()
                            .fill(phoneSession.isDesktopConnected ? WatchColors.success : WatchColors.error)
                            .frame(width: 8, height: 8)
                        Text(statusText)
                            .font(.caption)
                    }
                }

                // Active agents
                Section("Agents") {
                    NavigationLink {
                        AgentTriageView()
                    } label: {
                        HStack {
                            Image(systemName: "square.grid.2x2.fill")
                                .foregroundColor(WatchColors.primary)
                            Text("\(phoneSession.agentCount) active")
                        }
                    }

                    NavigationLink {
                        TaskStatusView()
                    } label: {
                        HStack {
                            Image(systemName: "list.bullet.rectangle")
                                .foregroundColor(WatchColors.primary)
                            Text("Task Status")
                        }
                    }
                }

                // Cost
                Section("Cost") {
                    NavigationLink {
                        CostView()
                    } label: {
                        HStack {
                            Image(systemName: "chart.bar.fill")
                                .foregroundColor(WatchColors.success)
                            Text("$\(String(format: "%.2f", phoneSession.todayCost)) today")
                        }
                    }
                }

                // Quick Actions
                Section("Dispatch") {
                    // H-E16: Watch dispatch surface — DispatchView lived in
                    // ios/WOTANNWatch/DispatchView.swift but was never wired
                    // into WatchHomeView, so the user couldn't reach it
                    // from the watch app. NavigationLink restores the path.
                    NavigationLink {
                        DispatchView()
                            .environmentObject(phoneSession)
                    } label: {
                        HStack {
                            Image(systemName: "paperplane.fill")
                                .foregroundColor(WatchColors.primary)
                            Text("Dispatch Task")
                        }
                    }
                }

                Section("Quick Actions") {
                    NavigationLink {
                        QuickActionsView()
                    } label: {
                        HStack {
                            Image(systemName: "bolt.fill")
                                .foregroundColor(WatchColors.warning)
                            Text("All Actions")
                        }
                    }

                    Button {
                        phoneSession.sendQuickAction("runTests")
                    } label: {
                        Label("Run Tests", systemImage: "checkmark.circle")
                    }
                    .disabled(!phoneSession.isDesktopConnected)

                    Button {
                        phoneSession.requestUpdate()
                    } label: {
                        Label("Check Status", systemImage: "info.circle")
                    }
                    .disabled(!phoneSession.isPhoneConnected)
                }
            }
            .navigationTitle("WOTANN")
            .onAppear {
                phoneSession.requestUpdate()
            }
        }
    }

    private var statusText: String {
        if !phoneSession.isPhoneConnected {
            return "iPhone not reachable"
        }
        return phoneSession.isDesktopConnected ? "Connected" : "Desktop disconnected"
    }
}

// MARK: - Agent Triage View

struct AgentTriageView: View {
    @EnvironmentObject var phoneSession: PhoneSessionDelegate

    var body: some View {
        List {
            if phoneSession.agents.isEmpty {
                Text("No active agents")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                ForEach(phoneSession.agents) { agent in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(agent.name)
                            .font(.caption.bold())
                        ProgressView(value: agent.progress)
                            .tint(agent.statusColor)
                        HStack {
                            Text(agent.status.capitalized)
                                .font(.caption2)
                                .foregroundColor(agent.statusColor)
                            Spacer()
                            Text(String(format: "$%.2f", agent.cost))
                                .font(.caption2.monospacedDigit())
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            Section {
                Button("Approve All") {
                    phoneSession.approveAll()
                }
                .foregroundColor(WatchColors.success)
                .disabled(phoneSession.agents.isEmpty)

                Button("Kill All") {
                    phoneSession.killAll()
                }
                .foregroundColor(WatchColors.error)
                .disabled(phoneSession.agents.isEmpty)
            }
        }
        .navigationTitle("Agents")
        .onAppear {
            phoneSession.requestUpdate()
        }
    }
}

// MARK: - Task Status View

/// Detailed view of all agent tasks with individual status, progress, and cost.
struct TaskStatusView: View {
    @EnvironmentObject var phoneSession: PhoneSessionDelegate

    var body: some View {
        List {
            if phoneSession.agents.isEmpty {
                Section {
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.circle")
                            .font(.title2)
                            .foregroundColor(.secondary)
                        Text("No tasks running")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
            } else {
                Section("Running") {
                    ForEach(phoneSession.agents.filter { $0.isRunning }) { agent in
                        TaskRow(agent: agent)
                    }
                }

                let completed = phoneSession.agents.filter { $0.status == "completed" }
                if !completed.isEmpty {
                    Section("Completed") {
                        ForEach(completed) { agent in
                            TaskRow(agent: agent)
                        }
                    }
                }

                let failed = phoneSession.agents.filter { $0.status == "failed" }
                if !failed.isEmpty {
                    Section("Failed") {
                        ForEach(failed) { agent in
                            TaskRow(agent: agent)
                        }
                    }
                }
            }
        }
        .navigationTitle("Tasks")
        .onAppear {
            phoneSession.requestUpdate()
        }
    }
}

/// Row displaying a single agent task with progress bar and cost.
private struct TaskRow: View {
    let agent: WatchAgent

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Circle()
                    .fill(agent.statusColor)
                    .frame(width: 6, height: 6)
                Text(agent.name)
                    .font(.caption.bold())
                    .lineLimit(1)
            }
            ProgressView(value: agent.progress)
                .tint(agent.statusColor)
            HStack {
                Text("\(Int(agent.progress * 100))%")
                    .font(.caption2.monospacedDigit())
                    .foregroundColor(.secondary)
                Spacer()
                Text(String(format: "$%.3f", agent.cost))
                    .font(.caption2.monospacedDigit())
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Quick Actions View

/// Expanded quick-action panel with grouped actions for fast agent control.
struct QuickActionsView: View {
    @EnvironmentObject var phoneSession: PhoneSessionDelegate
    @State private var lastActionFeedback: String?

    var body: some View {
        List {
            Section("Development") {
                QuickActionButton(
                    title: "Run Tests",
                    icon: "checkmark.circle",
                    color: WatchColors.success
                ) {
                    phoneSession.sendQuickAction("runTests")
                    lastActionFeedback = "Tests started"
                }

                QuickActionButton(
                    title: "Build Project",
                    icon: "hammer",
                    color: WatchColors.primary
                ) {
                    phoneSession.sendQuickAction("buildProject")
                    lastActionFeedback = "Build started"
                }

                QuickActionButton(
                    title: "Lint & Fix",
                    icon: "wand.and.stars",
                    color: WatchColors.warning
                ) {
                    phoneSession.sendQuickAction("lintFix")
                    lastActionFeedback = "Lint started"
                }
            }
            .disabled(!phoneSession.isDesktopConnected)

            Section("Agent Control") {
                QuickActionButton(
                    title: "Approve All",
                    icon: "checkmark.shield",
                    color: WatchColors.success
                ) {
                    phoneSession.approveAll()
                    lastActionFeedback = "All approved"
                }

                QuickActionButton(
                    title: "Kill All",
                    icon: "xmark.octagon",
                    color: WatchColors.error
                ) {
                    phoneSession.killAll()
                    lastActionFeedback = "All killed"
                }
            }
            .disabled(phoneSession.agents.isEmpty)

            Section("Input") {
                QuickActionButton(
                    title: "Voice Input",
                    icon: "mic.fill",
                    color: WatchColors.primary
                ) {
                    phoneSession.sendQuickAction("voiceInput")
                    lastActionFeedback = "Listening..."
                }

                QuickActionButton(
                    title: "Check Status",
                    icon: "info.circle",
                    color: WatchColors.primary
                ) {
                    phoneSession.requestUpdate()
                    lastActionFeedback = "Refreshed"
                }
            }
            .disabled(!phoneSession.isPhoneConnected)
        }
        .navigationTitle("Actions")
        .overlay(alignment: .bottom) {
            if let feedback = lastActionFeedback {
                Text(feedback)
                    .font(.caption2)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(.ultraThinMaterial, in: Capsule())
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            withAnimation { lastActionFeedback = nil }
                        }
                    }
            }
        }
    }
}

/// Reusable button row for quick actions.
private struct QuickActionButton: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .foregroundColor(color)
        }
    }
}

// MARK: - Cost View

/// Detailed cost breakdown with today's spend and per-agent costs.
struct CostView: View {
    @EnvironmentObject var phoneSession: PhoneSessionDelegate

    var body: some View {
        List {
            Section {
                VStack(spacing: 4) {
                    Text("Today")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Text(String(format: "$%.2f", phoneSession.todayCost))
                        .font(.title2.bold().monospacedDigit())
                        .foregroundColor(costColor)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }

            if !phoneSession.agents.isEmpty {
                Section("By Agent") {
                    ForEach(phoneSession.agents.sorted(by: { $0.cost > $1.cost })) { agent in
                        HStack {
                            Circle()
                                .fill(agent.statusColor)
                                .frame(width: 6, height: 6)
                            Text(agent.name)
                                .font(.caption)
                                .lineLimit(1)
                            Spacer()
                            Text(String(format: "$%.3f", agent.cost))
                                .font(.caption.monospacedDigit())
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }

            Section {
                HStack {
                    Text("Active agents")
                        .font(.caption)
                    Spacer()
                    Text("\(phoneSession.agentCount)")
                        .font(.caption.monospacedDigit())
                        .foregroundColor(.secondary)
                }
                HStack {
                    Text("Desktop")
                        .font(.caption)
                    Spacer()
                    Text(phoneSession.isDesktopConnected ? "Connected" : "Offline")
                        .font(.caption)
                        .foregroundColor(phoneSession.isDesktopConnected ? WatchColors.success : WatchColors.error)
                }
            }
        }
        .navigationTitle("Cost")
        .onAppear {
            phoneSession.requestUpdate()
        }
    }

    private var costColor: Color {
        if phoneSession.todayCost < 1.0 { return WatchColors.success }
        if phoneSession.todayCost < 5.0 { return WatchColors.warning }
        return WatchColors.error
    }
}

// MARK: - WatchColors

/// Design tokens mirroring WTheme.Colors for the Watch target (which cannot import the main app's DesignSystem).
enum WatchColors {
    static let primary = Color(red: 0x8B / 255.0, green: 0x5C / 255.0, blue: 0xF6 / 255.0)  // violet-500
    static let success = Color(red: 0x10 / 255.0, green: 0xB9 / 255.0, blue: 0x81 / 255.0)  // emerald-500
    static let warning = Color(red: 0xF5 / 255.0, green: 0x9E / 255.0, blue: 0x0B / 255.0)  // amber-500
    static let error   = Color(red: 0xF4 / 255.0, green: 0x3F / 255.0, blue: 0x5E / 255.0)  // rose-500
}
