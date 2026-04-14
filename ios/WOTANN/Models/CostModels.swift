import Foundation

// MARK: - CostSnapshot

/// A point-in-time snapshot of cost data from the desktop instance.
struct CostSnapshot: Codable {
    let todayTotal: Double
    let weekTotal: Double
    let monthTotal: Double
    let sessionTotal: Double
    let weeklyBudget: Double
    let byProvider: [ProviderCost]
    let byDay: [DayCost]
    let updatedAt: Date

    var budgetRemaining: Double {
        max(0, weeklyBudget - weekTotal)
    }

    var budgetPercent: Double {
        guard weeklyBudget > 0 else { return 0 }
        return min(1.0, weekTotal / weeklyBudget)
    }

    static let empty = CostSnapshot(
        todayTotal: 0,
        weekTotal: 0,
        monthTotal: 0,
        sessionTotal: 0,
        weeklyBudget: 50.0,
        byProvider: [],
        byDay: [],
        updatedAt: .now
    )
}

// MARK: - ProviderCost

struct ProviderCost: Identifiable, Codable, Hashable {
    var id: String { name }
    let name: String
    let amount: Double
    let requestCount: Int
}

// MARK: - DayCost

struct DayCost: Identifiable, Codable {
    var id: String { date }
    let date: String
    let amount: Double
}

// MARK: - MemoryResult

struct MemoryResult: Identifiable, Codable {
    let id: UUID
    let content: String
    let type: String
    let relevance: Double
    let timestamp: Date
}
