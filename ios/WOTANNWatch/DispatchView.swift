import SwiftUI

// MARK: - DispatchView (watchOS)
//
// V9 T5.9 (F12) — Apple Watch dispatch surface. Subscribes via
// `WatchService` to the RPC `watch.dispatch.subscribe` stream and
// renders active agent status. Tap a row to request the iPhone
// launch the full app at that agent (Handoff via
// `WKApplicationRefreshBackgroundTask` + URL payload).
//
// Smart Stack relevance: when an agent is running we raise the
// relevance signal so iOS 18 Smart Stack surfaces the watch face
// widget. Signals are capped at 1.0 and are best-effort.

struct DispatchView: View {
    @EnvironmentObject var phoneSession: PhoneSessionDelegate
    @StateObject private var watchService = WatchService()

    var body: some View {
        NavigationStack {
            List {
                Section("Active Dispatches") {
                    if watchService.dispatches.isEmpty {
                        Text("No active dispatches")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        ForEach(watchService.dispatches) { dispatch in
                            Button {
                                watchService.launchiPhone(for: dispatch)
                            } label: {
                                DispatchRow(dispatch: dispatch)
                            }
                        }
                    }
                }

                if let error = watchService.errorMessage {
                    Section {
                        Text(error)
                            .font(.caption2)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Dispatch")
            .onAppear {
                watchService.start(phoneSession: phoneSession)
            }
            .onDisappear {
                watchService.stop()
            }
        }
    }
}

// MARK: - DispatchRow

private struct DispatchRow: View {
    let dispatch: WatchDispatch

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(dispatch.title)
                .font(.caption.bold())
                .foregroundColor(.primary)
                .lineLimit(2)
            ProgressView(value: dispatch.progress)
                .tint(dispatch.statusColor)
            HStack {
                Text(dispatch.status.capitalized)
                    .font(.caption2)
                    .foregroundColor(dispatch.statusColor)
                Spacer()
                Text(dispatch.cost, format: .currency(code: "USD"))
                    .font(.caption2.monospacedDigit())
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Model

struct WatchDispatch: Identifiable, Equatable {
    let id: String
    let title: String
    let status: String
    let progress: Double
    let cost: Double

    var isRunning: Bool { status == "running" }
    var statusColor: Color {
        switch status {
        case "running":   return .blue
        case "completed": return .green
        case "failed":    return .red
        default:          return .orange
        }
    }
}
