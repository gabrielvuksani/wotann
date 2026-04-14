import Foundation

// MARK: - PairingState

/// State machine for the device pairing flow.
enum PairingState: Equatable {
    case unpaired
    case scanning
    case exchangingKeys
    case verifyingPin(pin: String)
    case paired(deviceName: String)
    case error(String)

    var isInProgress: Bool {
        switch self {
        case .scanning, .exchangingKeys, .verifyingPin:
            return true
        default:
            return false
        }
    }

    var isPaired: Bool {
        if case .paired = self { return true }
        return false
    }
}

// MARK: - RPCModels

/// JSON-RPC request envelope.
struct RPCRequest: Codable {
    let jsonrpc: String
    let method: String
    let params: [String: RPCValue]?
    let id: Int

    init(method: String, params: [String: RPCValue]? = nil, id: Int = Int.random(in: 1000...99999)) {
        self.jsonrpc = "2.0"
        self.method = method
        self.params = params
        self.id = id
    }
}

/// JSON-RPC response envelope.
struct RPCResponse: Codable {
    let jsonrpc: String
    let result: RPCValue?
    let error: RPCError?
    let id: Int?
}

struct RPCError: Codable {
    let code: Int
    let message: String
}

/// JSON-RPC event (server push).
struct RPCEvent: Codable {
    let jsonrpc: String
    let method: String
    let params: RPCValue?
}

/// Flexible JSON value for RPC payloads.
enum RPCValue: Codable, Hashable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case array([RPCValue])
    case object([String: RPCValue])
    case null

    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var intValue: Int? {
        if case .int(let i) = self { return i }
        return nil
    }

    var doubleValue: Double? {
        if case .double(let d) = self { return d }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    var arrayValue: [RPCValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    var objectValue: [String: RPCValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) { self = .string(s); return }
        if let i = try? container.decode(Int.self)    { self = .int(i); return }
        if let d = try? container.decode(Double.self)  { self = .double(d); return }
        if let b = try? container.decode(Bool.self)    { self = .bool(b); return }
        if let a = try? container.decode([RPCValue].self) { self = .array(a); return }
        if let o = try? container.decode([String: RPCValue].self) { self = .object(o); return }
        if container.decodeNil() { self = .null; return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported RPCValue type")
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .int(let i):    try container.encode(i)
        case .double(let d): try container.encode(d)
        case .bool(let b):   try container.encode(b)
        case .array(let a):  try container.encode(a)
        case .object(let o): try container.encode(o)
        case .null:          try container.encodeNil()
        }
    }
}

// MARK: - StreamEvent

/// Real-time streaming event from the desktop instance.
enum StreamEvent {
    case text(String)
    case toolUse(name: String, input: String)
    case artifact(Artifact)
    case done(tokensUsed: Int, cost: Double)
    case error(String)
}
