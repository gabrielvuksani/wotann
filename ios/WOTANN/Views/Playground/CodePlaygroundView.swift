import SwiftUI
import WebKit

/// Code Playground for iOS — sandboxed JavaScript execution via WKWebView.
/// Python execution is relayed to the KAIROS daemon.
///
/// NOTE: Uses WKWebView.evaluateJavaScript for sandboxed code execution.
/// This is intentional — the playground IS a code execution environment.

struct CodePlaygroundView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var code = "// Write JavaScript here\nconsole.log('Hello from WOTANN!');\n"
    @State private var output = ""
    @State private var selectedLanguage: PlaygroundLanguage = .javascript
    @State private var isRunning = false

    enum PlaygroundLanguage: String, CaseIterable {
        case javascript = "JavaScript"
        case python = "Python"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: WTheme.Spacing.sm) {
                Picker("Language", selection: $selectedLanguage) {
                    ForEach(PlaygroundLanguage.allCases, id: \.self) { lang in
                        Text(lang.rawValue).tag(lang)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 200)

                Spacer()

                Button(action: runCode) {
                    HStack(spacing: WTheme.Spacing.xs) {
                        if isRunning {
                            ProgressView().scaleEffect(0.7)
                        } else {
                            Image(systemName: "play.fill").font(.system(size: 12))
                        }
                        Text(isRunning ? "Running..." : "Run")
                            .font(WTheme.Typography.caption)
                            .fontWeight(.semibold)
                    }
                    .padding(.horizontal, WTheme.Spacing.md)
                    .padding(.vertical, WTheme.Spacing.xs)
                    .background(isRunning ? WTheme.Colors.textTertiary : WTheme.Colors.primary)
                    .foregroundColor(.white)
                    .cornerRadius(WTheme.Radius.sm)
                }
                .disabled(isRunning)

                Button("Clear") { code = ""; output = "" }
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .padding(WTheme.Spacing.sm)
            .background(WTheme.Colors.surfaceAlt)

            TextEditor(text: $code)
                .font(.system(.body, design: .monospaced))
                .foregroundColor(WTheme.Colors.textPrimary)
                .scrollContentBackground(.hidden)
                .background(WTheme.Colors.background)
                .padding(WTheme.Spacing.sm)

            Divider()

            VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                Text("OUTPUT")
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)

                ScrollView {
                    Text(output.isEmpty ? "(no output yet)" : output)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(output.contains("Error") ? WTheme.Colors.error : WTheme.Colors.success)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(WTheme.Spacing.sm)
            .frame(height: 150)
            .background(WTheme.Colors.surfaceAlt)
        }
        .navigationTitle("Playground")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func runCode() {
        isRunning = true
        switch selectedLanguage {
        case .javascript:
            runJavaScript()
        case .python:
            runPythonViaKairos()
        }
    }

    /// Sandboxed JS execution via WKWebView (intentional code execution)
    private func runJavaScript() {
        let webView = WKWebView(frame: .zero)
        // Wrap user code to capture console output
        let wrapper = "(function(){ var out=[]; var log=console.log; console.log=function(){out.push(Array.from(arguments).map(String).join(' '));}; try{ var r=" + jsEscape(code) + "; if(r!==undefined)out.push(String(r)); }catch(e){out.push('Error: '+e.message);} return out.join('\\n'); })()"

        webView.evaluateJavaScript(wrapper) { result, error in
            DispatchQueue.main.async {
                if let error = error {
                    self.output = "Error: \(error.localizedDescription)"
                } else {
                    self.output = (result as? String) ?? "(no output)"
                }
                self.isRunning = false
            }
        }
    }

    private func runPythonViaKairos() {
        Task {
            do {
                let escaped = code.replacingOccurrences(of: "'", with: "'\\''")
                let result = try await connectionManager.rpcClient.send(
                    "execute",
                    params: ["command": .string("python3 -c '\(escaped)'")]
                )
                await MainActor.run {
                    if let obj = result.result?.objectValue {
                        output = obj["stdout"]?.stringValue ?? "(no output)"
                    } else {
                        output = result.result?.stringValue ?? "(no output)"
                    }
                    isRunning = false
                }
            } catch {
                await MainActor.run {
                    output = "Error: Connect to desktop for Python execution."
                    isRunning = false
                }
            }
        }
    }

    private func jsEscape(_ str: String) -> String {
        str.replacingOccurrences(of: "\\", with: "\\\\")
           .replacingOccurrences(of: "\"", with: "\\\"")
           .replacingOccurrences(of: "\n", with: "\\n")
           .replacingOccurrences(of: "\r", with: "\\r")
    }
}
