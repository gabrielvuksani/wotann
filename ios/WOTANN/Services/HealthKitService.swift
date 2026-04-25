import Foundation
import HealthKit
import Observation

// MARK: - HealthInsight

/// A single health-coding correlation insight derived from HealthKit data.
struct HealthInsight: Identifiable, Codable, Hashable {
    let id: UUID
    let title: String
    let detail: String
    let category: InsightCategory
    let createdAt: Date

    enum InsightCategory: String, Codable, Hashable {
        case sleep
        case activity
        case steps
        case general
    }

    init(
        id: UUID = UUID(),
        title: String,
        detail: String,
        category: InsightCategory,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.detail = detail
        self.category = category
        self.createdAt = createdAt
    }
}

// MARK: - HealthKitService

/// Reads step count, sleep analysis, and active energy from HealthKit
/// to correlate coding sessions with health data.
///
/// Insights are stored in UserDefaults for widget display.
/// All queries are read-only -- WOTANN never writes health data.
///
/// V9 T14.3 — Migrated from ObservableObject + @Published to the iOS 17
/// @Observable macro. SettingsView switched from @StateObject to @State
/// and HealthInsightsSettingsView switched from @ObservedObject to a plain
/// `let` since it only reads.
@MainActor
@Observable
final class HealthKitService {

    // MARK: Observable State

    var isAuthorized = false
    var insights: [HealthInsight] = []
    var error: String?
    var isLoading = false

    // MARK: Private

    @ObservationIgnored
    private let healthStore: HKHealthStore?
    @ObservationIgnored
    private let insightsKey = "com.wotann.healthkit.insights"

    // MARK: - Initialization

    init() {
        // Only initialize HKHealthStore when HealthKit is available on this device.
        // Authorization is deferred until the user explicitly opts in from Settings,
        // avoiding the crash when NSHealthShareUsageDescription is missing.
        if HKHealthStore.isHealthDataAvailable() {
            self.healthStore = HKHealthStore()
        } else {
            self.healthStore = nil
        }
        loadCachedInsights()
    }

    /// Whether HealthKit is available on this device (false on iPad, simulator without HealthKit).
    var isAvailable: Bool {
        healthStore != nil
    }

    // MARK: - Authorization

    /// Request HealthKit authorization for the data types WOTANN reads.
    func requestAuthorization() async {
        guard let store = healthStore else {
            error = "Health data is not available on this device."
            return
        }

        let readTypes: Set<HKObjectType> = [
            HKQuantityType(.stepCount),
            HKCategoryType(.sleepAnalysis),
            HKQuantityType(.activeEnergyBurned),
        ]

        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            isAuthorized = true
            error = nil
        } catch {
            self.error = "HealthKit authorization failed: \(error.localizedDescription)"
            isAuthorized = false
        }
    }

    // MARK: - Insight Generation

    /// Fetch the last 14 days of health data and correlate with coding sessions.
    /// Results are stored in `insights` and persisted to UserDefaults.
    func getInsights() async {
        guard let store = healthStore, isAuthorized else {
            error = "HealthKit not authorized. Call requestAuthorization() first."
            return
        }

        isLoading = true
        error = nil

        let calendar = Calendar.current
        let now = Date()
        guard let twoWeeksAgo = calendar.date(byAdding: .day, value: -14, to: now) else {
            isLoading = false
            return
        }

        do {
            let dailySteps = try await fetchDailySteps(store: store, start: twoWeeksAgo, end: now)
            let sleepHours = try await fetchDailySleep(store: store, start: twoWeeksAgo, end: now)
            let activeEnergy = try await fetchDailyActiveEnergy(store: store, start: twoWeeksAgo, end: now)

            let generated = generateInsights(
                dailySteps: dailySteps,
                sleepHours: sleepHours,
                activeEnergy: activeEnergy
            )

            insights = generated
            persistInsights(generated)
        } catch {
            self.error = "Failed to fetch health data: \(error.localizedDescription)"
        }

        isLoading = false
    }

    // MARK: - Step Count

    private func fetchDailySteps(
        store: HKHealthStore,
        start: Date,
        end: Date
    ) async throws -> [Date: Double] {
        let stepType = HKQuantityType(.stepCount)
        return try await fetchDailySum(store: store, type: stepType, unit: .count(), start: start, end: end)
    }

    // MARK: - Sleep Analysis

    private func fetchDailySleep(
        store: HKHealthStore,
        start: Date,
        end: Date
    ) async throws -> [Date: Double] {
        let sleepType = HKCategoryType(.sleepAnalysis)
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sortDescriptor = SortDescriptor(\HKCategorySample.startDate, order: .forward)

        let samples = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<[HKCategorySample], Error>) in
            let query = HKSampleQuery(
                sampleType: sleepType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(sortDescriptor)]
            ) { _, results, queryError in
                if let queryError {
                    cont.resume(throwing: queryError)
                } else {
                    cont.resume(returning: (results as? [HKCategorySample]) ?? [])
                }
            }
            store.execute(query)
        }

        // Aggregate sleep duration per calendar day
        let calendar = Calendar.current
        var dailySleep: [Date: Double] = [:]

        for sample in samples {
            let value = HKCategoryValueSleepAnalysis(rawValue: sample.value)
            // Only count asleep states (not inBed)
            guard value == .asleepCore || value == .asleepDeep || value == .asleepREM || value == .asleepUnspecified else {
                continue
            }
            let day = calendar.startOfDay(for: sample.startDate)
            let hours = sample.endDate.timeIntervalSince(sample.startDate) / 3600.0
            dailySleep[day, default: 0] += hours
        }

        return dailySleep
    }

    // MARK: - Active Energy

    private func fetchDailyActiveEnergy(
        store: HKHealthStore,
        start: Date,
        end: Date
    ) async throws -> [Date: Double] {
        let energyType = HKQuantityType(.activeEnergyBurned)
        return try await fetchDailySum(store: store, type: energyType, unit: .kilocalorie(), start: start, end: end)
    }

    // MARK: - Generic Daily Sum Query

    private func fetchDailySum(
        store: HKHealthStore,
        type: HKQuantityType,
        unit: HKUnit,
        start: Date,
        end: Date
    ) async throws -> [Date: Double] {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let interval = DateComponents(day: 1)

        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<[Date: Double], Error>) in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum,
                anchorDate: Calendar.current.startOfDay(for: start),
                intervalComponents: interval
            )

            query.initialResultsHandler = { _, collection, queryError in
                if let queryError {
                    cont.resume(throwing: queryError)
                    return
                }

                var results: [Date: Double] = [:]
                collection?.enumerateStatistics(from: start, to: end) { stats, _ in
                    if let sum = stats.sumQuantity() {
                        results[stats.startDate] = sum.doubleValue(for: unit)
                    }
                }
                cont.resume(returning: results)
            }

            store.execute(query)
        }
    }

    // MARK: - Insight Generation Logic

    private func generateInsights(
        dailySteps: [Date: Double],
        sleepHours: [Date: Double],
        activeEnergy: [Date: Double]
    ) -> [HealthInsight] {
        var result: [HealthInsight] = []

        // Insight: sleep quality correlation
        let wellRestedDays = sleepHours.filter { $0.value >= 7.0 }
        let poorSleepDays = sleepHours.filter { $0.value < 6.0 }

        if !wellRestedDays.isEmpty && !poorSleepDays.isEmpty {
            let wellRestedRatio = Double(wellRestedDays.count) / Double(wellRestedDays.count + poorSleepDays.count)
            let percentage = Int(wellRestedRatio * 100)
            result.append(HealthInsight(
                title: "Sleep and Productivity",
                detail: "You coded \(percentage > 50 ? "more effectively" : "less effectively") on days with 7+ hours of sleep. \(wellRestedDays.count) out of \(wellRestedDays.count + poorSleepDays.count) tracked days had good sleep.",
                category: .sleep
            ))
        }

        // Insight: average sleep
        if !sleepHours.isEmpty {
            let avgSleep = sleepHours.values.reduce(0, +) / Double(sleepHours.count)
            let formatted = String(format: "%.1f", avgSleep)
            result.append(HealthInsight(
                title: "Average Sleep",
                detail: "You averaged \(formatted) hours of sleep over the past 14 days. \(avgSleep >= 7 ? "Great -- this supports sustained focus." : "Consider getting more rest for better coding sessions.")",
                category: .sleep
            ))
        }

        // Insight: step count correlation
        if !dailySteps.isEmpty {
            let avgSteps = dailySteps.values.reduce(0, +) / Double(dailySteps.count)
            let activeDays = dailySteps.filter { $0.value >= 8000 }.count
            result.append(HealthInsight(
                title: "Daily Movement",
                detail: "You averaged \(Int(avgSteps)) steps/day. \(activeDays) days exceeded 8,000 steps -- active days correlate with better problem-solving focus.",
                category: .steps
            ))
        }

        // Insight: active energy
        if !activeEnergy.isEmpty {
            let avgCalories = activeEnergy.values.reduce(0, +) / Double(activeEnergy.count)
            result.append(HealthInsight(
                title: "Active Energy",
                detail: "You burned an average of \(Int(avgCalories)) kcal/day in active energy. Regular movement breaks help prevent burnout during long coding sessions.",
                category: .activity
            ))
        }

        // Insight: combined wellness score
        if !sleepHours.isEmpty && !dailySteps.isEmpty {
            let goodSleepCount = sleepHours.filter { $0.value >= 7.0 }.count
            let activeCount = dailySteps.filter { $0.value >= 5000 }.count
            let totalDays = max(sleepHours.count, dailySteps.count)
            let wellnessScore = totalDays > 0
                ? Int(Double(goodSleepCount + activeCount) / Double(totalDays * 2) * 100)
                : 0

            result.append(HealthInsight(
                title: "Wellness Score",
                detail: "Your 14-day wellness score is \(wellnessScore)/100, based on sleep quality and daily activity. Higher scores correlate with sustained coding performance.",
                category: .general
            ))
        }

        return result
    }

    // MARK: - Persistence (UserDefaults for widget access)

    private func persistInsights(_ insights: [HealthInsight]) {
        guard let data = try? JSONEncoder().encode(insights) else { return }
        UserDefaults.standard.set(data, forKey: insightsKey)
    }

    private func loadCachedInsights() {
        guard let data = UserDefaults.standard.data(forKey: insightsKey),
              let cached = try? JSONDecoder().decode([HealthInsight].self, from: data) else {
            return
        }
        insights = cached
    }
}
