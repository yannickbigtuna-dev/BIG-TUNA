import Foundation

enum SharedSettings {
    static let appGroupIdentifier = "group.ca.yannickmorgans.bigtuna.lights"

    private enum Key {
        static let sessionToken = "sessionToken"
        static let username = "username"
        static let lastPhysicalOn = "lastPhysicalOn"
        static let lastUpdatedAt = "lastUpdatedAt"
    }

    private static var store: UserDefaults {
        UserDefaults(suiteName: appGroupIdentifier) ?? .standard
    }

    static var sessionToken: String? {
        let value = store.string(forKey: Key.sessionToken) ?? ""
        return value.isEmpty ? nil : value
    }

    static var username: String? {
        let value = store.string(forKey: Key.username) ?? ""
        return value.isEmpty ? nil : value
    }

    static var canControlLight: Bool {
        username?.lowercased() == "yannick" && sessionToken != nil
    }

    static var lastPhysicalOn: Bool? {
        store.object(forKey: Key.lastPhysicalOn) == nil ? nil : store.bool(forKey: Key.lastPhysicalOn)
    }

    static var lastUpdatedAt: String? {
        store.string(forKey: Key.lastUpdatedAt)
    }

    static func saveSession(_ session: LoginSession) {
        store.set(session.token, forKey: Key.sessionToken)
        store.set(session.username, forKey: Key.username)
    }

    static func clearSession() {
        store.removeObject(forKey: Key.sessionToken)
        store.removeObject(forKey: Key.username)
    }

    static func saveLastState(_ state: LightState) {
        store.set(state.physicalOn, forKey: Key.lastPhysicalOn)
        if let updatedAt = state.updatedAt {
            store.set(updatedAt, forKey: Key.lastUpdatedAt)
        }
    }
}
