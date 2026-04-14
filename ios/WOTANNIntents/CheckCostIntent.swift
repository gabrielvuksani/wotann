import AppIntents

// MARK: - CheckCostIntent

/// Siri intent to check current WOTANN usage costs.
struct CheckCostIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Check WOTANN Cost"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Check your current AI usage costs in WOTANN.",
        categoryName: "Cost"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(
        title: "Period",
        description: "Time period for cost summary",
        default: .today
    )
    var period: CostPeriod

    static var parameterSummary: some ParameterSummary {
        Summary("Check \(\.$period) cost")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let summary = await WOTANNIntentService.shared.getCostSummary(period: period.rawValue)
        return .result(value: summary)
    }
}

// MARK: - CostPeriod

enum CostPeriod: String, AppEnum {
    case today
    case week
    case month
    case session

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        "Cost Period"
    }

    static var caseDisplayRepresentations: [CostPeriod: DisplayRepresentation] {
        [
            .today: "Today",
            .week: "This Week",
            .month: "This Month",
            .session: "Current Session",
        ]
    }
}
