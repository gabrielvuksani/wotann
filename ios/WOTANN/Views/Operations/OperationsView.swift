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
    @State private var recordJSON = "{\"action\":\"tool:Read\",\"resource\":\"src/foo.ts\"}"
    @State private var lastEnvelopeJSON: String = ""
    @State private var output: String = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Generate or load Ed25519 audit keys, then sign and verify JSON records end-to-end. The signed envelope round-trips without leaving the daemon — keys never reach the phone.")
                .font(.callout)
                .foregroundColor(WTheme.Colors.textSecondary)
            TextField("Key id", text: $keyId).textFieldStyle(.roundedBorder)
            HStack(spacing: WTheme.Spacing.sm) {
                Button("Generate / load") { Task { await runGenkey() } }
                    .buttonStyle(.borderedProminent)
                Button("Sign record") { Task { await runSign() } }
                    .buttonStyle(.bordered)
                    .disabled(recordJSON.isEmpty)
                Button("Verify") { Task { await runVerify() } }
                    .buttonStyle(.bordered)
                    .disabled(lastEnvelopeJSON.isEmpty)
            }
            Text("Record JSON")
                .font(.caption)
                .foregroundColor(WTheme.Colors.textSecondary)
            TextEditor(text: $recordJSON)
                .frame(minHeight: 80)
                .font(.body.monospaced())
                .scrollContentBackground(.hidden)
                .padding(WTheme.Spacing.sm)
                .background(WTheme.Colors.surfaceAlt)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
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

    private func runGenkey() async {
        do {
            let result = try await connectionManager.rpcClient.attestGenkey(keyId)
            // Typed result (Round 6): show whether the key existed already or
            // was just minted, so users can spot accidental rotations.
            output = "id=\(result.id) existed=\(result.existed)\n\npublicPem (truncated):\n\(String(result.publicPem.prefix(120)))…"
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func runSign() async {
        do {
            // Parse the user's JSON record into [String: RPCValue].
            // attestSign() is the typed wrapper at RPCClient:1029.
            let recordValue = rpcFromJSON(recordJSON)
            guard case .object(let record) = recordValue else {
                errorMessage = "Record JSON must be a JSON object"
                return
            }
            let envelope = try await connectionManager.rpcClient.attestSign(
                record,
                id: keyId
            )
            if let err = envelope["error"]?.stringValue {
                errorMessage = err
                return
            }
            // Persist the envelope so "Verify" can re-use it.
            if let envelopeData = try? JSONSerialization.data(
                withJSONObject: rpcValueToAny(envelope),
                options: [.prettyPrinted, .sortedKeys]
            ),
               let pretty = String(data: envelopeData, encoding: .utf8) {
                lastEnvelopeJSON = pretty
                output = "Signed.\nEnvelope:\n\(pretty)"
            } else {
                output = "Signed (envelope serialization failed)."
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func runVerify() async {
        do {
            let envelopeValue = rpcFromJSON(lastEnvelopeJSON)
            guard case .object(let envelope) = envelopeValue else {
                errorMessage = "Last envelope is not a JSON object"
                return
            }
            let result = try await connectionManager.rpcClient.attestVerify(envelope)
            if let err = result["error"]?.stringValue {
                errorMessage = err
                return
            }
            let valid = result["valid"]?.boolValue ?? false
            let reason = result["reason"]?.stringValue ?? "(no reason)"
            output = valid ? "✓ Verified — \(reason)" : "✗ Verification FAILED — \(reason)"
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Lightweight RPCValue parser — the JSONSerialization output uses
    /// `Any` (NSDictionary/NSArray/NSNumber/NSString/NSNull) which we
    /// translate into the RPCValue tree the daemon expects.
    private func rpcFromJSON(_ jsonString: String) -> RPCValue {
        guard let data = jsonString.data(using: .utf8),
              let any = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return .null
        }
        return rpcFromAny(any)
    }

    private func rpcFromAny(_ any: Any) -> RPCValue {
        if any is NSNull { return .null }
        if let s = any as? String { return .string(s) }
        if let b = any as? Bool { return .bool(b) }
        if let n = any as? NSNumber {
            // NSNumber is sneaky — Bool slips through as NSNumber too.
            // We've already handled Bool above, so anything reaching here
            // is a real number. Distinguish int/double via the encoding.
            let s = String(cString: n.objCType)
            return s == "d" || s == "f" ? .double(n.doubleValue) : .int(n.intValue)
        }
        if let arr = any as? [Any] {
            return .array(arr.map(rpcFromAny))
        }
        if let dict = any as? [String: Any] {
            var out: [String: RPCValue] = [:]
            for (k, v) in dict { out[k] = rpcFromAny(v) }
            return .object(out)
        }
        return .null
    }

    private func rpcValueToAny(_ obj: [String: RPCValue]) -> Any {
        var out: [String: Any] = [:]
        for (k, v) in obj { out[k] = rpcValueToAnyOne(v) }
        return out
    }

    private func rpcValueToAnyOne(_ v: RPCValue) -> Any {
        switch v {
        case .null: return NSNull()
        case .bool(let b): return b
        case .int(let i): return i
        case .double(let d): return d
        case .string(let s): return s
        case .array(let arr): return arr.map(rpcValueToAnyOne)
        case .object(let obj): return rpcValueToAny(obj)
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
