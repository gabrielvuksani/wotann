import SwiftUI
import WidgetKit

// MARK: - AgentStatusWidget

/// systemMedium widget showing active agents.
struct AgentStatusWidget: Widget {
    let kind = "AgentStatusWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AgentTimelineProvider()) { entry in
            AgentWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Active Agents")
        .description("Shows running WOTANN agents and their status.")
        .supportedFamilies([.systemMedium])
    }
}

// MARK: - Entry

struct AgentEntry: TimelineEntry {
    let date: Date
    let agents: [WidgetAgent]
    let totalCost: Double
}

struct WidgetAgent: Identifiable {
    let id: String
    let title: String
    let status: String
    let progress: Double

    var provider: String { "" }
}

// MARK: - Provider

struct AgentTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> AgentEntry {
        AgentEntry(
            date: .now,
            agents: [
                WidgetAgent(id: UUID().uuidString, title: "Fix Tests", status: "running", progress: 0.65),
                WidgetAgent(id: UUID().uuidString, title: "Security Scan", status: "queued", progress: 0),
            ],
            totalCost: 0.45
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (AgentEntry) -> Void) {
        completion(loadEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AgentEntry>) -> Void) {
        let entry = loadEntry()
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 5, to: .now) ?? .now
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    /// Read agent data from the shared app group UserDefaults.
    private func loadEntry() -> AgentEntry {
        guard let defaults = UserDefaults(suiteName: "group.com.wotann.shared"),
              let jsonString = defaults.string(forKey: "agentStatus"),
              let jsonData = jsonString.data(using: .utf8),
              let rawArray = try? JSONSerialization.jsonObject(with: jsonData) as? [[String: Any]] else {
            // No data available -- return empty state.
            return AgentEntry(date: .now, agents: [], totalCost: 0)
        }

        var totalCost: Double = 0
        let agents: [WidgetAgent] = rawArray.compactMap { dict in
            guard let id = dict["id"] as? String,
                  let name = dict["name"] as? String,
                  let status = dict["status"] as? String else { return nil }
            let progress = dict["progress"] as? Double ?? 0
            let cost = dict["cost"] as? Double ?? 0
            totalCost += cost
            return WidgetAgent(id: id, title: name, status: status, progress: progress)
        }

        return AgentEntry(date: .now, agents: agents, totalCost: totalCost)
    }
}

// MARK: - Widget View

struct AgentWidgetView: View {
    let entry: AgentEntry

    private let bgColor = Color(red: 15/255, green: 23/255, blue: 42/255)
    private let primaryColor = Color(red: 99/255, green: 102/255, blue: 241/255)
    private let surfaceColor = Color(red: 30/255, green: 41/255, blue: 59/255)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Image(systemName: "w.circle.fill")
                    .font(.caption)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [primaryColor, Color(red: 6/255, green: 182/255, blue: 212/255)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Text("Agents")
                    .font(.caption.bold())
                    .foregroundColor(.white.opacity(0.7))

                Spacer()

                Text("\(entry.agents.count) active")
                    .font(.caption2)
                    .foregroundColor(primaryColor)
            }

            if entry.agents.isEmpty {
                Spacer()
                HStack {
                    Spacer()
                    Text("No active agents")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.4))
                    Spacer()
                }
                Spacer()
            } else {
                ForEach(entry.agents.prefix(3)) { agent in
                    agentRow(agent)
                }
            }

            Spacer(minLength: 0)

            HStack {
                Text("Total: $\(String(format: "%.2f", entry.totalCost))")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.white.opacity(0.4))
                Spacer()
            }
        }
        .padding(12)
    }

    private func agentRow(_ agent: WidgetAgent) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusColor(agent.status))
                .frame(width: 6, height: 6)

            Text(agent.title)
                .font(.caption2)
                .foregroundColor(.white)
                .lineLimit(1)

            Spacer()

            if agent.progress > 0 {
                Text("\(Int(agent.progress * 100))%")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(primaryColor)
            }
        }
        .padding(.vertical, 2)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "running":   return primaryColor
        case "queued":    return Color(red: 245/255, green: 158/255, blue: 11/255)
        case "completed": return Color(red: 16/255, green: 185/255, blue: 129/255)
        case "failed":    return Color(red: 244/255, green: 63/255, blue: 94/255)
        default:          return .gray
        }
    }
}

#Preview(as: .systemMedium) {
    AgentStatusWidget()
} timeline: {
    AgentEntry(
        date: .now,
        agents: [
            WidgetAgent(id: UUID().uuidString, title: "Fix Tests", status: "running", progress: 0.65),
            WidgetAgent(id: UUID().uuidString, title: "Security Scan", status: "queued", progress: 0),
        ],
        totalCost: 0.45
    )
}
