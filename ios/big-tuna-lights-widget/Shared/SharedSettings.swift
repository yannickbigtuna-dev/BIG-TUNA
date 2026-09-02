import Foundation

/// App-group storage deliberately contains only the revocable server session and
/// last *confirmed* relay state. Passwords are never persisted.
enum SharedSettings {
    static let appGroupIdentifier = "group.ca.yannickmorgans.bigtuna.lights"

    private enum Key {
        static let sessionToken = "sessionToken"
        static let username = "username"
        static let accessVerified = "accessVerified"
        static let lastPhysicalOn = "lastPhysicalOn"
        static let lastUpdatedAt = "lastUpdatedAt"
        static let revision = "revision"
        static let reportedPhysicalOn = "reportedPhysicalOn"
        static let recentlyPolled = "recentlyPolled"
        static let lastRelayHeartbeatAt = "lastRelayHeartbeatAt"
    }

    /// Falling back to standard defaults would split app and extension state
    /// and could make a control operate on the wrong cache. No App Group means
    /// no shared native control until signing is corrected.
    private static let store = UserDefaults(suiteName: appGroupIdentifier)
    static var isAppGroupAvailable: Bool { store != nil }

    static var sessionToken: String? {
        let value = store?.string(forKey: Key.sessionToken) ?? ""
        return value.isEmpty ? nil : value
    }

    static var username: String? {
        let value = store?.string(forKey: Key.username) ?? ""
        return value.isEmpty ? nil : value
    }

    /// A cached username alone must never authorize a widget action. This flag
    /// is set only after the active token is checked with `/api/auth/me`.
    static var canControlLight: Bool {
        accessVerified && username?.lowercased() == "yannick" && sessionToken != nil
    }

    static var accessVerified: Bool { store?.bool(forKey: Key.accessVerified) ?? false }

    static var lastPhysicalOn: Bool? {
        store?.object(forKey: Key.lastPhysicalOn) == nil ? nil : store?.bool(forKey: Key.lastPhysicalOn)
    }

    static var lastUpdatedAt: String? { store?.string(forKey: Key.lastUpdatedAt) }
    static var lastRevision: String? { store?.string(forKey: Key.revision) }
    static var lastReportedPhysicalOn: Bool? {
        store?.object(forKey: Key.reportedPhysicalOn) == nil ? nil : store?.bool(forKey: Key.reportedPhysicalOn)
    }
    static var lastRecentlyPolled: Bool { store?.bool(forKey: Key.recentlyPolled) ?? false }

    static var lastRelayHeartbeatAt: Date? {
        guard let interval = store?.object(forKey: Key.lastRelayHeartbeatAt) as? TimeInterval else { return nil }
        return Date(timeIntervalSince1970: interval)
    }

    static func saveSession(_ session: LoginSession) {
        store?.set(session.token, forKey: Key.sessionToken)
        store?.set(session.username, forKey: Key.username)
        store?.set(false, forKey: Key.accessVerified)
    }

    static func setAccessVerified(_ verified: Bool) { store?.set(verified, forKey: Key.accessVerified) }

    static func clearSession() {
        store?.removeObject(forKey: Key.sessionToken)
        store?.removeObject(forKey: Key.username)
        store?.removeObject(forKey: Key.accessVerified)
    }

    static func saveLastState(_ state: LightState) {
        store?.set(state.physicalOn, forKey: Key.lastPhysicalOn)
        store?.set(state.reportedPhysicalOn, forKey: Key.reportedPhysicalOn)
        store?.set(state.recentlyPolled, forKey: Key.recentlyPolled)
        store?.set(state.revision, forKey: Key.revision)
        if let updatedAt = state.updatedAt { store?.set(updatedAt, forKey: Key.lastUpdatedAt) }
        if state.recentlyPolled { store?.set(Date().timeIntervalSince1970, forKey: Key.lastRelayHeartbeatAt) }
    }

    static var relayRecentlyActive: Bool {
        guard let heartbeat = lastRelayHeartbeatAt else { return false }
        return Date().timeIntervalSince(heartbeat) < 6
    }
}
