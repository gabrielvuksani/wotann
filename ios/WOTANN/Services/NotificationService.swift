import Foundation
import UserNotifications

// MARK: - NotificationService

/// Schedules local notifications for task completion, errors, and budget alerts.
final class NotificationService {
    static let shared = NotificationService()

    private let center = UNUserNotificationCenter.current()

    private init() {}

    // MARK: - Permission

    func requestPermission() async -> Bool {
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            return granted
        } catch {
            return false
        }
    }

    // MARK: - Schedule

    func notifyTaskComplete(title: String, taskId: UUID) {
        let content = UNMutableNotificationContent()
        content.title = "Task Complete"
        content.body = title
        content.sound = .default
        content.categoryIdentifier = "TASK_COMPLETE"
        content.userInfo = ["taskId": taskId.uuidString]

        let request = UNNotificationRequest(
            identifier: "task-\(taskId.uuidString)",
            content: content,
            trigger: nil  // Deliver immediately
        )
        center.add(request)
    }

    func notifyTaskFailed(title: String, error: String, taskId: UUID) {
        let content = UNMutableNotificationContent()
        content.title = "Task Failed"
        content.body = "\(title): \(error)"
        content.sound = .defaultCritical
        content.categoryIdentifier = "TASK_FAILED"
        content.userInfo = ["taskId": taskId.uuidString]

        let request = UNNotificationRequest(
            identifier: "task-fail-\(taskId.uuidString)",
            content: content,
            trigger: nil
        )
        center.add(request)
    }

    func notifyApprovalRequired(title: String, taskId: UUID) {
        let content = UNMutableNotificationContent()
        content.title = "Approval Required"
        content.body = title
        content.sound = .default
        content.categoryIdentifier = "APPROVAL_REQUIRED"
        content.userInfo = ["taskId": taskId.uuidString]

        let approveAction = UNNotificationAction(identifier: "APPROVE", title: "Approve", options: [])
        let rejectAction = UNNotificationAction(identifier: "REJECT", title: "Reject", options: [.destructive])
        let category = UNNotificationCategory(
            identifier: "APPROVAL_REQUIRED",
            actions: [approveAction, rejectAction],
            intentIdentifiers: []
        )
        center.setNotificationCategories([category])

        let request = UNNotificationRequest(
            identifier: "approval-\(taskId.uuidString)",
            content: content,
            trigger: nil
        )
        center.add(request)
    }

    func notifyBudgetAlert(spent: Double, budget: Double) {
        let percent = Int((spent / budget) * 100)
        let content = UNMutableNotificationContent()
        content.title = "Budget Alert"
        content.body = "You've used \(percent)% of your weekly budget ($\(String(format: "%.2f", spent)) / $\(String(format: "%.2f", budget)))"
        content.sound = .default
        content.categoryIdentifier = "BUDGET_ALERT"

        let request = UNNotificationRequest(
            identifier: "budget-alert",
            content: content,
            trigger: nil
        )
        center.add(request)
    }

    // MARK: - Category Registration

    /// Update which notification categories are registered based on user preferences.
    /// Call whenever a notification toggle changes in Settings.
    func updateCategories(
        taskComplete: Bool,
        errors: Bool,
        budgetAlerts: Bool,
        approvalRequests: Bool
    ) {
        var categories = Set<UNNotificationCategory>()

        if taskComplete {
            categories.insert(UNNotificationCategory(
                identifier: "TASK_COMPLETE",
                actions: [],
                intentIdentifiers: []
            ))
        }

        if errors {
            categories.insert(UNNotificationCategory(
                identifier: "TASK_FAILED",
                actions: [],
                intentIdentifiers: []
            ))
        }

        if budgetAlerts {
            categories.insert(UNNotificationCategory(
                identifier: "BUDGET_ALERT",
                actions: [],
                intentIdentifiers: []
            ))
        }

        if approvalRequests {
            let approveAction = UNNotificationAction(identifier: "APPROVE", title: "Approve", options: [])
            let rejectAction = UNNotificationAction(identifier: "REJECT", title: "Reject", options: [.destructive])
            categories.insert(UNNotificationCategory(
                identifier: "APPROVAL_REQUIRED",
                actions: [approveAction, rejectAction],
                intentIdentifiers: []
            ))
        }

        center.setNotificationCategories(categories)
    }

    // MARK: - Clear

    func clearAll() {
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }
}
