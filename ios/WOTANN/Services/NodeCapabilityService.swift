import Foundation
import Combine
import CoreLocation
import EventKit
import Contacts
#if canImport(UIKit)
import UIKit
#endif

// MARK: - NodeCapabilityError

/// Errors from node capability invocations.
enum NodeCapabilityError: LocalizedError {
    case unknownCapability(String)
    case permissionDenied(String)
    case executionFailed(String)
    case invalidParams(String)

    var errorDescription: String? {
        switch self {
        case .unknownCapability(let name):
            return "Unknown capability: \(name)"
        case .permissionDenied(let detail):
            return "Permission denied: \(detail)"
        case .executionFailed(let detail):
            return "Execution failed: \(detail)"
        case .invalidParams(let detail):
            return "Invalid parameters: \(detail)"
        }
    }
}

// MARK: - NodeCapability

/// A single device capability that can be invoked remotely.
struct NodeCapability: Identifiable, Hashable {
    var id: String { name }
    let name: String
    let description: String
    let category: String
}

// MARK: - NodeCapabilityService

/// OpenClaw-inspired "phone as agent node" service.
///
/// The desktop WOTANN can invoke device capabilities on the phone via RPC:
/// - Camera, location, contacts, calendar, reminders
/// - Clipboard, screen capture, motion activity
/// - Local notifications
///
/// Capabilities are registered with the desktop's CompanionServer on connect.
/// Incoming `node.invoke` calls are routed to the appropriate handler.
@MainActor
final class NodeCapabilityService: ObservableObject {

    static let shared = NodeCapabilityService()

    // MARK: Published State

    @Published var registeredCapabilities: [NodeCapability] = []
    @Published var lastInvocation: String?
    @Published var isProcessing = false

    // MARK: Private Services

    private let cameraService = CameraService()
    private let locationManager = CLLocationManager()
    private let eventStore = EKEventStore()

    // MARK: - Available Capabilities

    static let capabilities: [NodeCapability] = [
        NodeCapability(name: "camera.snap", description: "Capture a photo", category: "camera"),
        NodeCapability(name: "camera.ocr", description: "Extract text from camera", category: "camera"),
        NodeCapability(name: "location.get", description: "Get current location", category: "location"),
        NodeCapability(name: "contacts.search", description: "Search contacts by name", category: "contacts"),
        NodeCapability(name: "calendar.events", description: "List upcoming calendar events", category: "calendar"),
        NodeCapability(name: "reminders.add", description: "Create a reminder", category: "reminders"),
        NodeCapability(name: "clipboard.get", description: "Read clipboard text", category: "clipboard"),
        NodeCapability(name: "clipboard.set", description: "Set clipboard text", category: "clipboard"),
        NodeCapability(name: "notification.local", description: "Show a local notification", category: "notification"),
        NodeCapability(name: "device.info", description: "Get device information", category: "device"),
    ]

    // MARK: - Registration

    /// Register all capabilities with the desktop WOTANN via RPC.
    func registerCapabilities(with rpcClient: RPCClient) async {
        let capabilityNames = Self.capabilities.map { RPCValue.string($0.name) }
        let capabilityDescriptions: [String: RPCValue] = Dictionary(
            uniqueKeysWithValues: Self.capabilities.map { ($0.name, RPCValue.string($0.description)) }
        )

        do {
            _ = try await rpcClient.send("node.register", params: [
                "capabilities": .array(capabilityNames),
                "descriptions": .object(capabilityDescriptions),
            ])
            registeredCapabilities = Self.capabilities
        } catch {
            // Registration failed; capabilities remain empty
            registeredCapabilities = []
        }

        // Subscribe to node.invoke events
        rpcClient.subscribe("node.invoke") { [weak self] event in
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.handleInvokeEvent(event, rpcClient: rpcClient)
            }
        }
    }

    // MARK: - Invoke Handler

    /// Handle an incoming `node.invoke` call from the desktop.
    func handleInvoke(capability: String, params: [String: RPCValue]) async throws -> RPCValue {
        isProcessing = true
        lastInvocation = capability
        defer { isProcessing = false }

        switch capability {

        case "camera.snap":
            #if canImport(UIKit)
            let image = try await cameraService.capturePhoto()
            guard let data = image.jpegData(compressionQuality: 0.8) else {
                throw NodeCapabilityError.executionFailed("Failed to encode image")
            }
            return .string(data.base64EncodedString())
            #else
            throw NodeCapabilityError.executionFailed("Camera unavailable on this platform")
            #endif

        case "camera.ocr":
            #if canImport(UIKit)
            let text = try await cameraService.captureAndExtractText()
            return .string(text)
            #else
            throw NodeCapabilityError.executionFailed("Camera unavailable on this platform")
            #endif

        case "location.get":
            return try await getCurrentLocation()

        case "contacts.search":
            guard let query = params["query"]?.stringValue else {
                throw NodeCapabilityError.invalidParams("Missing 'query' parameter")
            }
            return try await searchContacts(query: query)

        case "calendar.events":
            let days = params["days"]?.intValue ?? 7
            return try await getCalendarEvents(daysAhead: days)

        case "reminders.add":
            guard let title = params["title"]?.stringValue else {
                throw NodeCapabilityError.invalidParams("Missing 'title' parameter")
            }
            let notes = params["notes"]?.stringValue
            return try await addReminder(title: title, notes: notes)

        case "clipboard.get":
            #if canImport(UIKit)
            let text = UIPasteboard.general.string ?? ""
            return .string(text)
            #else
            return .string("")
            #endif

        case "clipboard.set":
            #if canImport(UIKit)
            guard let text = params["text"]?.stringValue else {
                throw NodeCapabilityError.invalidParams("Missing 'text' parameter")
            }
            UIPasteboard.general.string = text
            return .bool(true)
            #else
            throw NodeCapabilityError.executionFailed("Clipboard unavailable on this platform")
            #endif

        case "notification.local":
            guard let title = params["title"]?.stringValue else {
                throw NodeCapabilityError.invalidParams("Missing 'title' parameter")
            }
            let body = params["body"]?.stringValue ?? ""
            return try await sendLocalNotification(title: title, body: body)

        case "device.info":
            return getDeviceInfo()

        default:
            throw NodeCapabilityError.unknownCapability(capability)
        }
    }

    // MARK: - Event Router

    private func handleInvokeEvent(_ event: RPCEvent, rpcClient: RPCClient) async {
        guard case .object(let obj) = event.params,
              let capability = obj["capability"]?.stringValue else { return }

        let params: [String: RPCValue]
        if case .object(let p) = obj["params"] {
            params = p
        } else {
            params = [:]
        }

        let requestId = obj["requestId"]?.stringValue

        do {
            let result = try await handleInvoke(capability: capability, params: params)
            if let requestId {
                _ = try? await rpcClient.send("node.result", params: [
                    "requestId": .string(requestId),
                    "result": result,
                ])
            }
        } catch {
            if let requestId {
                _ = try? await rpcClient.send("node.error", params: [
                    "requestId": .string(requestId),
                    "error": .string(error.localizedDescription),
                ])
            }
        }
    }

    // MARK: - Capability Implementations

    private func getCurrentLocation() async throws -> RPCValue {
        guard CLLocationManager.locationServicesEnabled() else {
            throw NodeCapabilityError.permissionDenied("Location services are disabled")
        }

        let status = locationManager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            locationManager.requestWhenInUseAuthorization()
            throw NodeCapabilityError.permissionDenied("Location permission not granted")
        }

        guard let location = locationManager.location else {
            throw NodeCapabilityError.executionFailed("Location unavailable")
        }

        return .object([
            "latitude": .double(location.coordinate.latitude),
            "longitude": .double(location.coordinate.longitude),
            "altitude": .double(location.altitude),
            "accuracy": .double(location.horizontalAccuracy),
            "timestamp": .string(ISO8601DateFormatter().string(from: location.timestamp)),
        ])
    }

    private func searchContacts(query: String) async throws -> RPCValue {
        let store = CNContactStore()
        let authorized = try await store.requestAccess(for: .contacts)
        guard authorized else {
            throw NodeCapabilityError.permissionDenied("Contacts access denied")
        }

        let keysToFetch: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
        ]

        let predicate = CNContact.predicateForContacts(matchingName: query)
        let contacts = try store.unifiedContacts(matching: predicate, keysToFetch: keysToFetch)

        let results: [RPCValue] = contacts.prefix(10).map { contact in
            let phones = contact.phoneNumbers.map { RPCValue.string($0.value.stringValue) }
            let emails = contact.emailAddresses.map { RPCValue.string($0.value as String) }

            return .object([
                "name": .string("\(contact.givenName) \(contact.familyName)"),
                "phones": .array(phones),
                "emails": .array(emails),
            ])
        }

        return .array(results)
    }

    private func getCalendarEvents(daysAhead: Int) async throws -> RPCValue {
        let granted = try await eventStore.requestFullAccessToEvents()
        guard granted else {
            throw NodeCapabilityError.permissionDenied("Calendar access denied")
        }

        let start = Date.now
        let end = Calendar.current.date(byAdding: .day, value: daysAhead, to: start) ?? start
        let predicate = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = eventStore.events(matching: predicate)

        let results: [RPCValue] = events.prefix(20).map { event in
            let formatter = ISO8601DateFormatter()
            return .object([
                "title": .string(event.title ?? ""),
                "start": .string(formatter.string(from: event.startDate)),
                "end": .string(formatter.string(from: event.endDate)),
                "location": .string(event.location ?? ""),
                "isAllDay": .bool(event.isAllDay),
            ])
        }

        return .array(results)
    }

    private func addReminder(title: String, notes: String?) async throws -> RPCValue {
        let granted = try await eventStore.requestFullAccessToReminders()
        guard granted else {
            throw NodeCapabilityError.permissionDenied("Reminders access denied")
        }

        let reminder = EKReminder(eventStore: eventStore)
        reminder.title = title
        reminder.notes = notes
        reminder.calendar = eventStore.defaultCalendarForNewReminders()

        try eventStore.save(reminder, commit: true)

        return .object([
            "id": .string(reminder.calendarItemIdentifier),
            "title": .string(title),
            "created": .bool(true),
        ])
    }

    private func sendLocalNotification(title: String, body: String) async throws -> RPCValue {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized else {
            throw NodeCapabilityError.permissionDenied("Notification permission not granted")
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let id = UUID().uuidString
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        try await center.add(request)

        return .object([
            "id": .string(id),
            "sent": .bool(true),
        ])
    }

    private func getDeviceInfo() -> RPCValue {
        #if canImport(UIKit)
        let device = UIDevice.current
        return .object([
            "name": .string(device.name),
            "model": .string(device.model),
            "systemName": .string(device.systemName),
            "systemVersion": .string(device.systemVersion),
            "batteryLevel": .double(Double(device.batteryLevel)),
        ])
        #else
        return .object([
            "name": .string("Unknown"),
            "model": .string("Unknown"),
            "systemName": .string("Unknown"),
            "systemVersion": .string("Unknown"),
        ])
        #endif
    }
}
