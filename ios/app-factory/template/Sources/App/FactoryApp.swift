import SwiftUI

@main
struct FactoryApp: App {
    init() {
#if canImport(WatchConnectivity)
        FactoryWatchConnectivity.shared.activate()
#endif
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
