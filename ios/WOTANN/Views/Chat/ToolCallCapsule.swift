import SwiftUI

// MARK: - ToolCallCapsule

/// Inline capsule displayed in an assistant message when the model invokes
/// a tool. Shows a wrench icon + tool name + elapsed duration in a
/// 32pt-tall pill. Tapping expands the capsule to reveal the raw JSON
/// arguments and result side-by-side inside the chat stream.
///
/// Data here is purely view-state; callers pass an already-prepared
/// `ToolCallDisplay` value. This keeps the capsule immutable and
/// independent from any networking or persistence layer.
struct ToolCallCapsule: View {
    let call: ToolCallDisplay
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if expanded {
                details
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(WTheme.Colors.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(WTheme.Colors.border.opacity(0.6), lineWidth: 0.5)
        )
    }

    private var header: some View {
        Button {
            Haptics.shared.buttonTap()
            withAnimation(.spring(duration: 0.3, bounce: 0.1)) {
                expanded.toggle()
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "wrench.and.screwdriver.fill")
                    .font(.wotannScaled(size: 11, weight: .medium))
                    .foregroundColor(WTheme.Colors.primary)
                Text(call.name)
                    .font(.wotannScaled(size: 12, weight: .semibold, design: .rounded))
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text(formattedDuration)
                    .font(.wotannScaled(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textTertiary)
                Spacer(minLength: 4)
                statusIcon
                Image(systemName: "chevron.down")
                    .font(.wotannScaled(size: 10, weight: .bold))
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
            }
            .padding(.horizontal, 12)
            .frame(height: 32)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(call.name), \(formattedDuration)")
        .accessibilityHint("Double tap to \(expanded ? "collapse" : "expand") tool details")
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch call.status {
        case .running:
            ProgressView()
                .controlSize(.mini)
                .tint(WTheme.Colors.primary)
        case .success:
            Image(systemName: "checkmark.circle.fill")
                .font(.wotannScaled(size: 11))
                .foregroundColor(WTheme.Colors.success)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.wotannScaled(size: 11))
                .foregroundColor(WTheme.Colors.error)
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
                .background(WTheme.Colors.border.opacity(0.4))

            if let args = call.argsJSON, !args.isEmpty {
                labeledBlock(title: "Arguments", text: args)
            }
            if let result = call.resultJSON, !result.isEmpty {
                labeledBlock(title: "Result", text: result)
            }
            if let err = call.errorMessage, !err.isEmpty {
                labeledBlock(title: "Error", text: err, tint: WTheme.Colors.error)
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func labeledBlock(title: String, text: String, tint: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.wotannScaled(size: 10, weight: .bold, design: .rounded))
                .tracking(0.4)
                .foregroundColor(tint ?? WTheme.Colors.textSecondary)
            Text(text)
                .font(.wotannScaled(size: 11, design: .monospaced))
                .foregroundColor(WTheme.Colors.textPrimary)
                .textSelection(.enabled)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(WTheme.Colors.surfaceAlt.opacity(0.5))
                )
        }
    }

    private var formattedDuration: String {
        if call.durationSeconds >= 1 {
            return String(format: "%.1fs", call.durationSeconds)
        } else {
            let ms = Int(call.durationSeconds * 1000)
            return "\(ms)ms"
        }
    }
}

// MARK: - Value Types

/// Immutable display data for a single tool call.
struct ToolCallDisplay: Identifiable, Hashable {
    let id: UUID
    let name: String
    let durationSeconds: Double
    let argsJSON: String?
    let resultJSON: String?
    let errorMessage: String?
    let status: Status

    enum Status: String, Hashable {
        case running
        case success
        case failed
    }

    init(
        id: UUID = UUID(),
        name: String,
        durationSeconds: Double,
        argsJSON: String? = nil,
        resultJSON: String? = nil,
        errorMessage: String? = nil,
        status: Status = .success
    ) {
        self.id = id
        self.name = name
        self.durationSeconds = durationSeconds
        self.argsJSON = argsJSON
        self.resultJSON = resultJSON
        self.errorMessage = errorMessage
        self.status = status
    }
}

#Preview {
    VStack(spacing: 12) {
        ToolCallCapsule(call: ToolCallDisplay(
            name: "read_file",
            durationSeconds: 0.8,
            argsJSON: "{\n  \"path\": \"src/index.ts\"\n}",
            resultJSON: "{\n  \"lines\": 128\n}",
            status: .success
        ))
        ToolCallCapsule(call: ToolCallDisplay(
            name: "run_tests",
            durationSeconds: 2.4,
            status: .running
        ))
    }
    .padding()
    .background(Color.black)
    .preferredColorScheme(.dark)
}
