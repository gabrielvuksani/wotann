import SwiftUI

// MARK: - OperationsView
//
// Tabbed admin/dev tools mirroring desktop OperationsPanel: Inspect /
// Attest / Policy / Canary / Evolve.

struct OperationsView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var tab: OpsTab = .inspect

    enum OpsTab: String, CaseIterable, Identifiable {
        case inspect, attest, policy, canary, evolve
        var id: String { rawValue }
        var label: String {
            switch self {
            case .inspect: return "Inspect"
            case .attest:  return "Attest"
            case .policy:  return "Policy"
            case .canary:  return "Canary"
            case .evolve:  return "Evolve"
            }
        }
    }

    var body: some View {
        Group {
            // Audit caught: every per-tab form invokes daemon RPC; without
            // a top-level pairing guard the user gets cryptic per-tab error
            // messages until they pair. Mirrors BlocksView/TeamsView.
            if !connectionManager.isPaired {
                DaemonOfflineView()
            } else {
                VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                    Picker("", selection: $tab) {
                        ForEach(OpsTab.allCases) { t in
                            Text(t.label).tag(t)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, WTheme.Spacing.md)

                    ScrollView {
                        Group {
                            switch tab {
                            case .inspect: InspectTabView()
                            case .attest:  AttestTabView()
                            case .policy:  PolicyTabView()
                            case .canary:  CanaryTabView()
                            case .evolve:  EvolveTabView()
                            }
                        }
                        .padding(WTheme.Spacing.md)
                    }
                }
            }
        }
        .navigationTitle("Operations")
    }
}

private struct InspectTabView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var path = ""
    @State private var declared = ""
    @State private var output: String = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Detect a file's true content type via magic bytes (and optional ML upgrade).")
                .font(.callout)
                .foregroundColor(WTheme.Colors.textSecondary)
            TextField("/path/to/file", text: $path).textFieldStyle(.roundedBorder)
            TextField("Declared type (optional)", text: $declared).textFieldStyle(.roundedBorder)
            Button("Inspect") { Task { await run() } }.buttonStyle(.borderedProminent)
            if let errorMessage {
                Text(errorMessage).foregroundColor(WTheme.Colors.warning).font(.caption)
            }
            if !output.isEmpty {
                Text(output)
                    .font(.body.monospaced())
                    .padding(WTheme.Spacing.sm)
                    .background(WTheme.Colors.surfaceAlt)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }
        }
    }

    private func run() async {
        do {
            let result = try await connectionManager.rpcClient.inspectPath(path, declared: declared.isEmpty ? nil : declared)
            output = String(describing: result)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct AttestTabView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var keyId = "default"
    @State private var output: String = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Generate or load Ed25519 audit keys. Use the CLI to sign + verify a JSON record end-to-end.")
                .font(.callout)
                .foregroundColor(WTheme.Colors.textSecondary)
            TextField("Key id", text: $keyId).textFieldStyle(.roundedBorder)
            Button("Generate / load") { Task { await run() } }.buttonStyle(.borderedProminent)
            if let errorMessage {
                Text(errorMessage).foregroundColor(WTheme.Colors.warning).font(.caption)
            }
            if !output.isEmpty {
                Text(output)
                    .font(.body.monospaced())
                    .padding(WTheme.Spacing.sm)
                    .background(WTheme.Colors.surfaceAlt)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }
        }
    }

    private func run() async {
        do {
            let result = try await connectionManager.rpcClient.attestGenkey(keyId)
            output = String(describing: result)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct PolicyTabView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var policy = """
permit(principal == "agent:reviewer", action == "tool:Read");
forbid(principal == "*", action == "tool:Bash", resource ~ "rm -rf");
"""
    @State private var principal = "agent:reviewer"
    @State private var action = "tool:Read"
    @State private var resource = "src/foo.ts"
    @State private var output: String = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Cedar-style permit/forbid evaluator. Default-deny semantics.")
                .font(.callout)
                .foregroundColor(WTheme.Colors.textSecondary)
            TextEditor(text: $policy)
                .frame(minHeight: 100)
                .font(.body.monospaced())
                .scrollContentBackground(.hidden)
                .padding(WTheme.Spacing.sm)
                .background(WTheme.Colors.surfaceAlt)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            TextField("Principal", text: $principal).textFieldStyle(.roundedBorder)
            TextField("Action", text: $action).textFieldStyle(.roundedBorder)
            TextField("Resource", text: $resource).textFieldStyle(.roundedBorder)
            Button("Evaluate") { Task { await run() } }.buttonStyle(.borderedProminent)
            if let errorMessage {
                Text(errorMessage).foregroundColor(WTheme.Colors.warning).font(.caption)
            }
            if !output.isEmpty {
                Text(output)
                    .font(.body.monospaced())
                    .padding(WTheme.Spacing.sm)
                    .background(WTheme.Colors.surfaceAlt)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }
        }
    }

    private func run() async {
        do {
            let result = try await connectionManager.rpcClient.policyEvaluate(policy: policy, principal: principal, action: action, resource: resource)
            output = String(describing: result)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct CanaryTabView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var probeUrl = ""
    @State private var samples = "5"
    @State private var output: String = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Capture a metric baseline from a probe URL before deploying.")
                .font(.callout)
                .foregroundColor(WTheme.Colors.textSecondary)
            TextField("Probe URL (returns metric JSON)", text: $probeUrl).textFieldStyle(.roundedBorder)
            TextField("Samples", text: $samples)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
            Button("Capture baseline") { Task { await run() } }.buttonStyle(.borderedProminent)
            if let errorMessage {
                Text(errorMessage).foregroundColor(WTheme.Colors.warning).font(.caption)
            }
            if !output.isEmpty {
                Text(output)
                    .font(.body.monospaced())
                    .padding(WTheme.Spacing.sm)
                    .background(WTheme.Colors.surfaceAlt)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }
        }
    }

    private func run() async {
        do {
            let result = try await connectionManager.rpcClient.canaryCaptureBaseline(probeUrl: probeUrl, samples: Int(samples) ?? 5)
            output = String(describing: result)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct EvolveTabView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Skill Evolution").font(.title3.bold())
            Text("The GEPA-style optimizer is a CLI workflow. Trigger from a terminal:")
                .font(.callout)
                .foregroundColor(WTheme.Colors.textSecondary)
            Text("wotann evolve <skill.md> --generations 3 --write")
                .font(.body.monospaced())
                .padding(WTheme.Spacing.sm)
                .background(WTheme.Colors.surfaceAlt)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
        }
    }
}
