import Foundation
import Observation

// MARK: - StreamHandler
//
// V9 T14.3 — Migrated from `ObservableObject` + `@Published` to the iOS 17
// `@Observable` macro. `StreamHandler` is held privately by `ChatViewModel`
// (never injected into SwiftUI as an environment object) so the migration is
// strictly internal — no consumer-side changes required. Per-property
// observation under `@Observable` keeps streaming-text invalidations from
// triggering an artifacts-list re-render and vice versa.

/// Handles real-time streaming events from the desktop.
/// Parses incremental text chunks, tool use events, and completion signals.
@MainActor
@Observable
final class StreamHandler {
    var currentText = ""
    var isStreaming = false
    var artifacts: [Artifact] = []

    @ObservationIgnored
    private var onTextChunk: ((String) -> Void)?
    @ObservationIgnored
    private var onComplete: ((Int, Double) -> Void)?
    @ObservationIgnored
    private var onError: ((String) -> Void)?

    func startStream(
        onText: @escaping (String) -> Void,
        onComplete: @escaping (Int, Double) -> Void,
        onError: @escaping (String) -> Void
    ) {
        isStreaming = true
        currentText = ""
        artifacts = []
        self.onTextChunk = onText
        self.onComplete = onComplete
        self.onError = onError
    }

    func handleEvent(_ event: RPCEvent) {
        guard let params = event.params else { return }

        switch event.method {
        case "stream.text":
            if case .string(let chunk) = params {
                currentText += chunk
                onTextChunk?(chunk)
            } else if case .object(let obj) = params,
                      let text = obj["text"]?.stringValue ?? obj["content"]?.stringValue {
                currentText += text
                onTextChunk?(text)
            }

        case "stream.tool_use":
            if case .object(let obj) = params,
               let name = obj["name"]?.stringValue ?? obj["toolName"]?.stringValue,
               let input = obj["input"]?.stringValue ?? obj["content"]?.stringValue {
                let artifact = Artifact(
                    type: .code,
                    content: input,
                    title: "Tool: \(name)"
                )
                artifacts.append(artifact)
            }

        case "stream.artifact":
            if let data = try? JSONEncoder().encode(params),
               let artifact = try? JSONDecoder().decode(Artifact.self, from: data) {
                artifacts.append(artifact)
            }

        case "stream.done":
            var tokens = 0
            var cost = 0.0
            if case .object(let obj) = params {
                tokens = obj["tokensUsed"]?.intValue ?? 0
                cost = obj["cost"]?.doubleValue ?? obj["costUsd"]?.doubleValue ?? 0
            }
            isStreaming = false
            onComplete?(tokens, cost)
            cleanup()

        case "stream.error":
            let message: String
            if case .string(let s) = params {
                message = s
            } else if case .object(let obj) = params {
                message = obj["message"]?.stringValue ?? obj["content"]?.stringValue ?? "Unknown error"
            } else {
                message = "Unknown streaming error"
            }
            isStreaming = false
            onError?(message)
            cleanup()

        default:
            break
        }
    }

    func cancelStream() {
        isStreaming = false
        cleanup()
    }

    private func cleanup() {
        onTextChunk = nil
        onComplete = nil
        onError = nil
    }
}
