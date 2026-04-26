import Foundation

// MARK: - AgentTask

/// A background agent task running on the desktop WOTANN instance.
struct AgentTask: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var status: TaskState
    var progress: Double
    var provider: String
    var model: String
    var cost: Double
    var startedAt: Date
    var completedAt: Date?
    var logs: [TaskLog]
    /// Populated when `status == .failed`. Shown in failure notifications.
    var errorMessage: String?

    var duration: TimeInterval {
        let end = completedAt ?? Date.now
        return end.timeIntervalSince(startedAt)
    }

    var formattedDuration: String {
        let total = Int(duration)
        let minutes = total / 60
        let seconds = total % 60
        if minutes > 0 {
            return "\(minutes)m \(seconds)s"
        }
        return "\(seconds)s"
    }

    init(
        id: UUID = UUID(),
        title: String,
        status: TaskState = .queued,
        progress: Double = 0,
        // Provider neutrality fix: empty default. Caller MUST supply real values
        // from the user's selected provider — no anthropic / claude-opus bias.
        provider: String = "",
        model: String = "",
        cost: Double = 0,
        startedAt: Date = .now,
        completedAt: Date? = nil,
        logs: [TaskLog] = [],
        errorMessage: String? = nil
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.progress = progress
        self.provider = provider
        self.model = model
        self.cost = cost
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.logs = logs
        self.errorMessage = errorMessage
    }
}

// MARK: - TaskState

enum TaskState: String, Codable, Hashable {
    case queued
    case running
    case paused
    case completed
    case failed
    case cancelled
    case approvalRequired

    var displayName: String {
        switch self {
        case .queued:           return "Queued"
        case .running:          return "Running"
        case .paused:           return "Paused"
        case .completed:        return "Completed"
        case .failed:           return "Failed"
        case .cancelled:        return "Cancelled"
        case .approvalRequired: return "Approval Required"
        }
    }

    var iconName: String {
        switch self {
        case .queued:           return "clock"
        case .running:          return "play.circle.fill"
        case .paused:           return "pause.circle.fill"
        case .completed:        return "checkmark.circle.fill"
        case .failed:           return "xmark.circle.fill"
        case .cancelled:        return "stop.circle.fill"
        case .approvalRequired: return "hand.raised.fill"
        }
    }

    var isActive: Bool {
        self == .queued || self == .running || self == .paused || self == .approvalRequired
    }
}

// MARK: - TaskLog

/// A single log entry from an agent task.
struct TaskLog: Identifiable, Codable, Hashable {
    let id: UUID
    let level: LogLevel
    let message: String
    let timestamp: Date

    init(
        id: UUID = UUID(),
        level: LogLevel = .info,
        message: String,
        timestamp: Date = .now
    ) {
        self.id = id
        self.level = level
        self.message = message
        self.timestamp = timestamp
    }
}

enum LogLevel: String, Codable, Hashable {
    case debug
    case info
    case warning
    case error

    var iconName: String {
        switch self {
        case .debug:   return "ant"
        case .info:    return "info.circle"
        case .warning: return "exclamationmark.triangle"
        case .error:   return "xmark.octagon"
        }
    }
}

// MARK: - DispatchRequest

/// A request to dispatch a new task from phone to desktop.
struct DispatchRequest: Codable {
    let prompt: String
    let provider: String?
    let model: String?
    let template: DispatchTemplate?
}

enum DispatchTemplate: String, Codable, CaseIterable {
    case fixTests      = "fix_tests"
    case reviewPR      = "review_pr"
    case securityScan  = "security_scan"
    case codeReview    = "code_review"
    case refactor      = "refactor"
    case documentation = "documentation"
    case custom        = "custom"

    var displayName: String {
        switch self {
        case .fixTests:      return "Fix Tests"
        case .reviewPR:      return "Review PR"
        case .securityScan:  return "Security Scan"
        case .codeReview:    return "Code Review"
        case .refactor:      return "Refactor"
        case .documentation: return "Documentation"
        case .custom:        return "Custom Task"
        }
    }

    var icon: String {
        switch self {
        case .fixTests:      return "hammer.fill"
        case .reviewPR:      return "magnifyingglass"
        case .securityScan:  return "shield.fill"
        case .codeReview:    return "eye.fill"
        case .refactor:      return "arrow.triangle.2.circlepath"
        case .documentation: return "doc.text.fill"
        case .custom:        return "pencil.and.outline"
        }
    }

    var defaultPrompt: String {
        switch self {
        case .fixTests:      return "Fix all failing tests and ensure they pass."
        case .reviewPR:      return "Review the latest pull request for issues."
        case .securityScan:  return "Run a comprehensive security audit."
        case .codeReview:    return "Review the codebase for quality issues."
        case .refactor:      return "Refactor the specified module for clarity."
        case .documentation: return "Generate documentation for the project."
        case .custom:        return ""
        }
    }
}
