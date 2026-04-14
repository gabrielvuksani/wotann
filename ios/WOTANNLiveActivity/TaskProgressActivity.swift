import SwiftUI
import WidgetKit

#if canImport(ActivityKit)
import ActivityKit

// MARK: - Task Progress Live Activity

/// Shows autonomous task progress in Dynamic Island and Lock Screen.
struct TaskProgressAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var taskTitle: String
        var progress: Double
        var status: String
        var cost: Double
        var elapsedSeconds: Int
    }

    var taskId: String
    var provider: String
    var model: String
}

// MARK: - Live Activity Widget

struct TaskProgressLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TaskProgressAttributes.self) { context in
            // Lock Screen banner
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .stroke(Color.gray.opacity(0.2), lineWidth: 4)
                        .frame(width: 40, height: 40)
                    Circle()
                        .trim(from: 0, to: context.state.progress)
                        .stroke(progressColor(context.state.progress), lineWidth: 4)
                        .frame(width: 40, height: 40)
                        .rotationEffect(.degrees(-90))
                    Text("\(Int(context.state.progress * 100))%")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(.white)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.taskTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        Text(context.state.status)
                            .font(.system(size: 11))
                            .foregroundColor(.gray)
                        Text("$\(String(format: "%.4f", context.state.cost))")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.green)
                    }
                }
                Spacer()
            }
            .padding(16)
            .background(Color(red: 0.06, green: 0.06, blue: 0.07))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.taskTitle)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(Int(context.state.progress * 100))%")
                        .font(.system(size: 14, weight: .bold, design: .monospaced))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressView(value: context.state.progress)
                }
            } compactLeading: {
                Image(systemName: "w.circle.fill")
                    .foregroundColor(.purple)
            } compactTrailing: {
                Text("\(Int(context.state.progress * 100))%")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
            } minimal: {
                Image(systemName: "w.circle.fill")
                    .foregroundColor(.purple)
            }
        }
    }
}

private func progressColor(_ progress: Double) -> Color {
    if progress >= 1.0 { return .green }
    if progress >= 0.5 { return .blue }
    return .purple
}

#endif
