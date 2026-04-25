import SwiftUI

// MARK: - ChatView

/// Phase C chat shell. Delegates send / enhance / regenerate to
/// `ChatViewModel`; owns only local presentation state.
///
/// Layout:
/// * Borderless message list over OLED black. Messages flow edge-to-edge;
///   user messages sit in blue 20pt bubbles, assistant replies render as
///   plain text with no bubble.
/// * Pull-to-refresh at the top syncs fresh state from the desktop via
///   `appState.syncFromDesktop(using:)`.
/// * The new `Composer` docks at the bottom using the safe-area inset so
///   it floats above the home indicator with proper spacing.
/// * Full-screen voice mode is reached via long-press on the mic.
struct ChatView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @StateObject private var viewModel: ChatViewModel

    init(
        conversationId: UUID,
        appState: AppState,
        connectionManager: ConnectionManager,
        onDeviceModelService: OnDeviceModelService
    ) {
        _viewModel = StateObject(wrappedValue: ChatViewModel(
            conversationId: conversationId,
            appState: appState,
            connectionManager: connectionManager,
            onDeviceModelService: onDeviceModelService
        ))
    }

    var body: some View {
        ChatViewContent(viewModel: viewModel)
    }
}

// MARK: - ChatViewContent

struct ChatViewContent: View {
    @StateObject var viewModel: ChatViewModel
    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var connectionManager: ConnectionManager

    @State private var showVoiceInline = false
    @State private var showMeetMode = false
    @State private var showPlayground = false
    @State private var showRemoteDesktop = false
    @State private var showCameraInput = false
    @State private var showGitPanel = false
    @State private var autopilotOn = false
    @State private var quotedReply: String?
    /// Path of the file to open in the WOTANN editor sheet. nil = sheet hidden.
    /// Bound to `Composer.onMentionFile` so a `@file:<path>` mention pushes
    /// EditorView fullscreen with the file pre-loaded.
    @State private var editorFilePath: String?

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                connectionStatusBar
                if let error = viewModel.errorMessage {
                    ErrorBanner(
                        message: error,
                        type: .error,
                        onRetry: { viewModel.errorMessage = nil }
                    )
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
                messageList
            }

            composerDock
        }
        .background(Color.black)
        .navigationTitle(viewModel.conversation?.title ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { chatToolbar }
        .fullScreenCover(isPresented: $showVoiceInline) {
            VoiceInlineSheet { text in
                viewModel.inputText = text
                viewModel.sendMessage()
            }
        }
        .sheet(isPresented: $viewModel.showEnhanceSheet) {
            EnhancedPromptSheet(
                original: viewModel.inputText,
                enhanced: viewModel.enhancedText,
                improvements: viewModel.enhanceImprovements,
                onAccept: { viewModel.acceptEnhancement() },
                onCancel: { viewModel.showEnhanceSheet = false }
            )
        }
        .sheet(isPresented: $showMeetMode) { MeetModeView() }
        .sheet(isPresented: $showPlayground) {
            NavigationStack {
                CodePlaygroundView()
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showPlayground = false }
                        }
                    }
            }
        }
        .fullScreenCover(isPresented: $showRemoteDesktop) { RemoteDesktopView() }
        .sheet(isPresented: $showGitPanel) { GitPanelView() }
        .sheet(isPresented: $showCameraInput) {
            CameraInputSheet(connectionManager: connectionManager)
        }
        .fullScreenCover(item: Binding(
            get: { editorFilePath.map(EditorPath.init) },
            set: { editorFilePath = $0?.path }
        )) { wrapper in
            EditorView(
                connectionManager: connectionManager,
                initialSource: .remote(path: wrapper.path),
                onSendToChat: { prompt in
                    // The editor's "Ask WOTANN" / inline AI menu funnels
                    // its prompt back into the composer here. We append a
                    // newline-separated chunk so the user can review and
                    // edit before sending.
                    if viewModel.inputText.isEmpty {
                        viewModel.inputText = prompt
                    } else {
                        viewModel.inputText += "\n\n" + prompt
                    }
                    editorFilePath = nil
                }
            )
            .environmentObject(connectionManager)
        }
    }

    // MARK: - Connection Status

    @ViewBuilder
    private var connectionStatusBar: some View {
        if !connectionManager.isConnected {
            ErrorBanner(
                message: "Not connected to desktop",
                type: .disconnected,
                onRetry: {
                    if let device = connectionManager.pairedDevice {
                        connectionManager.connect(host: device.host, port: device.port)
                    }
                }
            )
        } else if connectionManager.connectionMode == .relay {
            statusChip(
                icon: "antenna.radiowaves.left.and.right",
                text: "Connected via Remote Bridge",
                color: WTheme.Colors.warning
            )
        } else if connectionManager.connectionMode == .queued {
            statusChip(
                icon: "tray.full",
                text: "Messages queued for delivery",
                color: WTheme.Colors.textTertiary
            )
        }
    }

    private func statusChip(icon: String, text: String, color: Color) -> some View {
        HStack(spacing: WTheme.Spacing.xs) {
            Image(systemName: icon)
                .font(.caption2)
            Text(text)
                .font(WTheme.Typography.caption2)
        }
        .foregroundColor(color)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.xs)
        .background(color.opacity(0.08))
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var chatToolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            VStack(spacing: 0) {
                Text(viewModel.conversation?.title ?? "Chat")
                    .font(.wotannScaled(size: 15, weight: .semibold, design: .rounded))
                    .foregroundColor(WTheme.Colors.textPrimary)
                if let conv = viewModel.conversation {
                    ProviderBadge(provider: conv.provider, size: .small)
                }
            }
        }
        ToolbarItem(placement: .secondaryAction) {
            Button {
                showMeetMode = true
            } label: {
                Image(systemName: "person.wave.2.fill")
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .accessibilityLabel("Meet Mode")
        }
        ToolbarItem(placement: .primaryAction) {
            Menu {
                if let conv = viewModel.conversation {
                    Button {
                        viewModel.toggleStar()
                    } label: {
                        Label(
                            conv.isStarred ? "Unstar" : "Star",
                            systemImage: conv.isStarred ? "star.slash" : "star.fill"
                        )
                    }
                }
                Divider()
                Button { showCameraInput = true } label: {
                    Label("Camera Input", systemImage: "camera.fill")
                }
                Button { showPlayground = true } label: {
                    Label("Playground", systemImage: "chevron.left.forwardslash.chevron.right")
                }
                Button { showRemoteDesktop = true } label: {
                    Label("Remote Desktop", systemImage: "desktopcomputer")
                }
                Button { showGitPanel = true } label: {
                    Label("Git", systemImage: "arrow.triangle.branch")
                }
                Divider()
                Button(role: .destructive) {
                    viewModel.clearChat()
                } label: {
                    Label("Clear Chat", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .accessibilityLabel("Chat options")
        }
    }

    // MARK: - Message List

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 14) {
                    if let conv = viewModel.conversation {
                        if conv.messages.isEmpty {
                            chatEmptyState
                                .padding(.top, WTheme.Spacing.xl)
                        } else {
                            ForEach(conv.messages) { message in
                                MessageRow(
                                    message: message,
                                    onRegenerate: message.role == .assistant ? {
                                        viewModel.regenerateMessage(id: message.id)
                                    } : nil,
                                    onDelete: {
                                        viewModel.deleteMessage(id: message.id)
                                    },
                                    onReply: { quotedMessage in
                                        insertQuote(for: quotedMessage)
                                    },
                                    onRerunCompare: nil,
                                    onFork: nil,
                                    onReact: { _ in }
                                )
                                .id(message.id)
                                .transition(.asymmetric(
                                    insertion: .move(edge: .bottom).combined(with: .opacity),
                                    removal: .opacity
                                ))
                            }
                        }
                    }
                    // Reserve space so the bottom message clears the docked composer.
                    Color.clear.frame(height: composerReservedHeight)
                }
                .padding(.horizontal, 12)
                .padding(.top, WTheme.Spacing.sm)
            }
            .refreshable {
                await refreshFromDesktop()
            }
            .scrollContentBackground(.hidden)
            .onChange(of: viewModel.messages.count) { _, _ in
                if let lastId = viewModel.messages.last?.id {
                    withAnimation(WTheme.Animation.smooth) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
        }
    }

    /// Reserve enough bottom padding so the newest message is not occluded
    /// by the docked composer. 160pt covers the expanded composer + chips.
    private var composerReservedHeight: CGFloat { 200 }

    private var chatEmptyState: some View {
        VStack(spacing: WTheme.Spacing.lg) {
            Spacer(minLength: 40)
            WLogo(size: 44, glowRadius: 20)
            Text("What can I help with?")
                .font(.wotannScaled(size: 22, weight: .bold, design: .rounded))
                .tracking(-0.4)
                .foregroundColor(WTheme.Colors.textPrimary)
            Text("Type a message or tap the mic to begin")
                .font(.wotannScaled(size: 13))
                .foregroundColor(WTheme.Colors.textSecondary)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                quickActionCard(title: "Build", subtitle: "Write code", icon: "hammer.fill", color: WTheme.Colors.primary) {
                    viewModel.inputText = QuickActionPrompts.build
                    viewModel.sendMessage()
                }
                quickActionCard(title: "Debug", subtitle: "Fix a bug", icon: "ant.fill", color: WTheme.Colors.error) {
                    viewModel.inputText = QuickActionPrompts.debug
                    viewModel.sendMessage()
                }
                quickActionCard(title: "Review", subtitle: "Check code", icon: "doc.text.magnifyingglass", color: WTheme.Colors.success) {
                    viewModel.inputText = QuickActionPrompts.review
                    viewModel.sendMessage()
                }
                quickActionCard(title: "Explain", subtitle: "Understand code", icon: "lightbulb.fill", color: WTheme.Colors.warning) {
                    viewModel.inputText = QuickActionPrompts.explain
                    viewModel.sendMessage()
                }
            }
            .padding(.horizontal, WTheme.Spacing.md)
        }
        .frame(maxWidth: .infinity)
    }

    private func quickActionCard(
        title: String,
        subtitle: String,
        icon: String,
        color: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: {
            Haptics.shared.buttonTap()
            action()
        }) {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: icon)
                    .font(.wotannScaled(size: 16, weight: .semibold))
                    .foregroundColor(color)
                Text(title)
                    .font(.wotannScaled(size: 14, weight: .semibold, design: .rounded))
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text(subtitle)
                    .font(.wotannScaled(size: 11))
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(WTheme.Colors.surface)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Composer Dock

    private var composerDock: some View {
        Composer(
            text: $viewModel.inputText,
            isStreaming: viewModel.isStreaming,
            isEnhancing: viewModel.isEnhancing,
            currentModel: displayModel,
            currentProvider: displayProvider,
            estimatedCost: estimatedCost,
            autopilotOn: autopilotOn,
            onSend: { viewModel.sendMessage() },
            onEnhance: { viewModel.enhancePrompt() },
            onCancel: { viewModel.cancelStreaming() },
            onVoicePressHold: { showVoiceInline = true },
            onPlus: { showCameraInput = true },
            onToggleAutopilot: {
                autopilotOn.toggle()
                Haptics.shared.toggleOn()
            },
            onSlashCommand: nil,
            onMention: nil,
            onSkill: nil,
            onMentionFile: { path in
                // Pop the editor full-screen with the resolved file. Composer
                // already substituted `@file:<path>` into the input text.
                editorFilePath = path
            },
            quotedReply: quotedReply,
            onClearQuote: { quotedReply = nil }
        )
        .background(
            Color.black
                .shadow(color: .black.opacity(0.4), radius: 16, x: 0, y: -4)
        )
    }

    private var displayModel: String {
        viewModel.conversation?.model ?? appState.currentModel
    }

    private var displayProvider: String {
        viewModel.conversation?.provider ?? appState.currentProvider
    }

    /// Rough per-request cost estimate based on current input length.
    /// Serves as a preview only — authoritative numbers come from the
    /// desktop response.
    private var estimatedCost: Double {
        let tokens = max(1, viewModel.inputText.count / 4)
        return Double(tokens) * 0.000015
    }

    // MARK: - Helpers

    private func insertQuote(for message: Message) {
        let snippet = message.content.prefix(200)
        quotedReply = String(snippet)
    }

    private func refreshFromDesktop() async {
        Haptics.shared.pullToRefresh()
        await appState.syncFromDesktop(using: connectionManager.rpcClient)
    }
}

// MARK: - EditorPath
//
// Identifiable wrapper around a file path so SwiftUI's `.fullScreenCover(item:)`
// can drive the EditorView. Plain `String` doesn't conform to Identifiable
// because two equal paths must collapse to a single sheet.

private struct EditorPath: Identifiable, Hashable {
    let path: String
    var id: String { path }

    /// Unlabelled initializer so `.map(EditorPath.init)` is concise.
    init(_ path: String) {
        self.path = path
    }
}

// MARK: - CameraInputSheet

/// Presents the ContinuityCameraService for capturing a photo as chat context.
struct CameraInputSheet: View {
    @EnvironmentObject var cameraService: ContinuityCameraService
    let connectionManager: ConnectionManager
    @Environment(\.dismiss) private var dismiss
    @State private var isCaptureInProgress = false

    var body: some View {
        NavigationStack {
            VStack(spacing: WTheme.Spacing.lg) {
                if cameraService.isStreaming {
                    VStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "camera.viewfinder")
                            .font(.wotannScaled(size: 48))
                            .foregroundColor(WTheme.Colors.primary)

                        Text("Camera Active")
                            .font(WTheme.Typography.headline)
                            .foregroundColor(WTheme.Colors.textPrimary)

                        if let deviceName = cameraService.activeDeviceName {
                            Text(deviceName)
                                .font(WTheme.Typography.caption)
                                .foregroundColor(WTheme.Colors.textSecondary)
                        }

                        Button {
                            capturePhoto()
                        } label: {
                            HStack {
                                Image(systemName: "camera.circle.fill")
                                Text("Capture Photo")
                            }
                            .font(WTheme.Typography.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, WTheme.Spacing.md)
                            .background(WTheme.Colors.primary)
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                        }
                        .disabled(isCaptureInProgress)
                        .padding(.horizontal, WTheme.Spacing.xl)
                    }
                } else {
                    VStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "camera")
                            .font(.wotannScaled(size: 48))
                            .foregroundColor(WTheme.Colors.textTertiary)

                        Text("Start Camera")
                            .font(WTheme.Typography.headline)
                            .foregroundColor(WTheme.Colors.textPrimary)

                        Text("Use Continuity Camera to capture context for the conversation")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .multilineTextAlignment(.center)

                        Button {
                            startCamera()
                        } label: {
                            Text("Start Capture")
                                .font(WTheme.Typography.headline)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, WTheme.Spacing.md)
                                .background(WTheme.Colors.primary)
                                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                        }
                        .padding(.horizontal, WTheme.Spacing.xl)
                    }
                }

                if let error = cameraService.error {
                    Text(error.localizedDescription)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.error)
                }

                Spacer()
            }
            .padding(.top, WTheme.Spacing.xl)
            .background(WTheme.Colors.background)
            .navigationTitle("Camera Input")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        cameraService.stopCapture()
                        dismiss()
                    }
                }
            }
        }
    }

    private func startCamera() {
        Task {
            let granted = await cameraService.requestPermission()
            guard granted else { return }
            try? await cameraService.startCapture(rpcClient: connectionManager.rpcClient)
        }
    }

    private func capturePhoto() {
        isCaptureInProgress = true
        Task {
            defer { isCaptureInProgress = false }
            guard let photoData = try? await cameraService.capturePhoto() else { return }
            let base64 = photoData.base64EncodedString()
            _ = try? await connectionManager.rpcClient.send("continuity.photo", params: [
                "photo": .string(base64),
            ])
            dismiss()
        }
    }
}
