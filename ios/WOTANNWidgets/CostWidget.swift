import SwiftUI
import WidgetKit

// MARK: - CostWidget

/// systemSmall widget showing today's cost.
struct CostWidget: Widget {
    let kind = "CostWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CostTimelineProvider()) { entry in
            CostWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Today's Cost")
        .description("Shows your WOTANN spending for today.")
        .supportedFamilies([.systemSmall])
    }
}

// MARK: - Entry

struct CostEntry: TimelineEntry {
    let date: Date
    let todayCost: Double
    let weekCost: Double
    let weeklyBudget: Double
}

// MARK: - Provider

struct CostTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> CostEntry {
        CostEntry(date: .now, todayCost: 1.23, weekCost: 12.45, weeklyBudget: 50.0)
    }

    private static let sharedDefaults = UserDefaults(suiteName: "group.com.wotann.shared")

    func getSnapshot(in context: Context, completion: @escaping (CostEntry) -> Void) {
        let defaults = Self.sharedDefaults ?? .standard
        let entry = CostEntry(
            date: .now,
            todayCost: defaults.double(forKey: "widget.todayCost"),
            weekCost: defaults.double(forKey: "widget.weekCost"),
            weeklyBudget: defaults.double(forKey: "widget.budget")
        )
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CostEntry>) -> Void) {
        let defaults = Self.sharedDefaults ?? .standard
        let entry = CostEntry(
            date: .now,
            todayCost: defaults.double(forKey: "widget.todayCost"),
            weekCost: defaults.double(forKey: "widget.weekCost"),
            weeklyBudget: defaults.double(forKey: "widget.budget")
        )
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: .now) ?? .now
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }
}

// MARK: - Widget View

struct CostWidgetView: View {
    let entry: CostEntry

    private let bgColor = Color(red: 15/255, green: 23/255, blue: 42/255)
    private let primaryColor = Color(red: 99/255, green: 102/255, blue: 241/255)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
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
                Text("WOTANN")
                    .font(.caption2.bold())
                    .foregroundColor(.white.opacity(0.7))
            }

            Spacer()

            Text("Today")
                .font(.caption2)
                .foregroundColor(.white.opacity(0.5))

            Text(formattedCost(entry.todayCost))
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundColor(.white)

            // Budget progress
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(.white.opacity(0.15))
                        .frame(height: 4)

                    let pct = entry.weeklyBudget > 0
                        ? min(1.0, entry.weekCost / entry.weeklyBudget)
                        : 0
                    RoundedRectangle(cornerRadius: 2)
                        .fill(primaryColor)
                        .frame(width: max(0, geo.size.width * pct), height: 4)
                }
            }
            .frame(height: 4)

            Text("$\(String(format: "%.0f", entry.weeklyBudget - entry.weekCost)) left this week")
                .font(.system(size: 9))
                .foregroundColor(.white.opacity(0.4))
        }
        .padding(12)
    }

    private func formattedCost(_ amount: Double) -> String {
        if amount < 0.01 {
            return "$\(String(format: "%.4f", amount))"
        } else {
            return "$\(String(format: "%.2f", amount))"
        }
    }
}

#Preview(as: .systemSmall) {
    CostWidget()
} timeline: {
    CostEntry(date: .now, todayCost: 2.34, weekCost: 18.56, weeklyBudget: 50.0)
}
