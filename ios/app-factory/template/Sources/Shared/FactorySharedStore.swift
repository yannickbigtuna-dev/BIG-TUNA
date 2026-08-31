import Foundation

enum FactorySharedStore {
    static var defaults: UserDefaults {
        guard FactoryAppConfiguration.usesAppGroup,
              let groupID = FactoryAppConfiguration.appGroupID,
              let groupedDefaults = UserDefaults(suiteName: groupID) else {
            return .standard
        }
        return groupedDefaults
    }

    static func queueTransfer(_ payload: Data) {
        // App-specific synchronization can persist payloads here before a network
        // or WatchConnectivity transfer becomes available. Keep payload formats
        // versioned and migrate them explicitly in the owning app.
        defaults.set(payload, forKey: "factory.pendingTransfer")
    }
}
