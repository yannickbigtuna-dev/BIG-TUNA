import Foundation

#if canImport(WatchConnectivity)
import WatchConnectivity
#endif

struct WatchLightState: Codable, Equatable {
    let physicalOn: Bool
    let reportedPhysicalOn: Bool?
    let recentlyPolled: Bool
    let updatedAt: String
    let revision: String

    /// A desired state returned by the native API is authoritative even when
    /// the relay has not reported a recent physical poll.
    var hasConfirmedDesiredState: Bool {
        !updatedAt.isEmpty && !revision.isEmpty
    }
}

enum WatchLightAvailability: Equatable {
    case ready(WatchLightState)
    case stale(WatchLightState)
    case signedOut
    case offline(String)

    var state: WatchLightState? {
        switch self {
        case .ready(let state), .stale(let state): return state
        case .signedOut, .offline: return nil
        }
    }

    var mayControl: Bool {
        if case .ready = self { return true }
        return false
    }
}

enum WatchLightAPIError: LocalizedError {
    case notAuthenticated
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: return "Sign in on iPhone as yannick."
        case .invalidResponse: return "The light service returned an invalid response."
        case .server(let message): return message
        }
    }
}

/// Shared Watch App Group cache populated only from an authoritative HTTPS
/// response or a WatchConnectivity application-context update sent by the
/// paired iPhone app. It intentionally never records an optimistic target state.
/// The credential is a revocable server session, never an account password.
enum WatchLightStore {
    static let appGroupIdentifier = "group.ca.yannickmorgans.bigtuna.lights"
    private enum Key {
        static let sessionToken = "sessionToken"
        static let username = "username"
        static let lastPhysicalOn = "lastPhysicalOn"
        static let lastUpdatedAt = "lastUpdatedAt"
        static let revision = "revision"
        static let reportedPhysicalOn = "reportedPhysicalOn"
        static let recentlyPolled = "recentlyPolled"
    }

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    static var isAppGroupAvailable: Bool {
        defaults != nil
    }

    static var token: String? {
        let value = defaults?.string(forKey: Key.sessionToken) ?? ""
        return value.isEmpty ? nil : value
    }

    static var canControl: Bool {
        token != nil && defaults?.string(forKey: Key.username)?.lowercased() == "yannick"
    }

    static var cachedState: WatchLightState? {
        guard
            let defaults,
            defaults.object(forKey: Key.lastPhysicalOn) != nil,
            let updatedAt = defaults.string(forKey: Key.lastUpdatedAt),
            let revision = defaults.string(forKey: Key.revision)
        else { return nil }
        let reported = defaults.object(forKey: Key.reportedPhysicalOn) == nil
            ? nil : defaults.bool(forKey: Key.reportedPhysicalOn)
        return WatchLightState(
            physicalOn: defaults.bool(forKey: Key.lastPhysicalOn),
            reportedPhysicalOn: reported,
            recentlyPolled: defaults.bool(forKey: Key.recentlyPolled),
            updatedAt: updatedAt,
            revision: revision
        )
    }

    static func save(_ state: WatchLightState) {
        defaults?.set(state.physicalOn, forKey: Key.lastPhysicalOn)
        defaults?.set(state.reportedPhysicalOn, forKey: Key.reportedPhysicalOn)
        defaults?.set(state.recentlyPolled, forKey: Key.recentlyPolled)
        defaults?.set(state.updatedAt, forKey: Key.lastUpdatedAt)
        defaults?.set(state.revision, forKey: Key.revision)
    }

    static func clearSession() {
        defaults?.removeObject(forKey: Key.sessionToken)
        defaults?.removeObject(forKey: Key.username)
    }

    static func applyPhoneContext(_ context: [String: Any]) {
        guard let defaults else { return }
        if let token = context[Key.sessionToken] as? String {
            if token.isEmpty {
                defaults.removeObject(forKey: Key.sessionToken)
            } else {
                defaults.set(token, forKey: Key.sessionToken)
            }
        }
        if let username = context[Key.username] as? String {
            if username.isEmpty {
                defaults.removeObject(forKey: Key.username)
                defaults.removeObject(forKey: Key.sessionToken)
            } else {
                defaults.set(username, forKey: Key.username)
                if username.lowercased() != "yannick" {
                    defaults.removeObject(forKey: Key.sessionToken)
                }
            }
        }
        guard
            let physicalOn = context[Key.lastPhysicalOn] as? Bool,
            let updatedAt = context[Key.lastUpdatedAt] as? String,
            let revision = context[Key.revision] as? String
        else { return }
        save(WatchLightState(
            physicalOn: physicalOn,
            reportedPhysicalOn: context[Key.reportedPhysicalOn] as? Bool,
            recentlyPolled: context[Key.recentlyPolled] as? Bool ?? false,
            updatedAt: updatedAt,
            revision: revision
        ))
    }
}

enum WatchLightAPI {
    private static let endpoint = URL(string: "https://yannickmorgans.ca/api/lights/native/v1")!

    private struct SetLightPayload: Encodable {
        let physicalOn: Bool
        let commandId: String
    }

    static func fetchState(token: String) async throws -> WatchLightState {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return try await send(request)
    }

    static func setPhysicalLight(on physicalOn: Bool, token: String, commandID: UUID = UUID()) async throws -> WatchLightState {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "PUT"
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(
            SetLightPayload(physicalOn: physicalOn, commandId: commandID.uuidString)
        )
        return try await send(request)
    }

    private static func send(_ request: URLRequest) async throws -> WatchLightState {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw WatchLightAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 {
                WatchLightStore.clearSession()
                throw WatchLightAPIError.notAuthenticated
            }
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw WatchLightAPIError.server(message ?? "Light request failed (\(http.statusCode)).")
        }
        guard let state = try? JSONDecoder().decode(WatchLightState.self, from: data) else {
            throw WatchLightAPIError.invalidResponse
        }
        return state
    }
}

#if canImport(WatchConnectivity)
final class WatchLightConnectivity: NSObject, WCSessionDelegate {
    static let shared = WatchLightConnectivity()

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        WatchLightStore.applyPhoneContext(session.receivedApplicationContext)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        WatchLightStore.applyPhoneContext(applicationContext)
    }
}
#endif
