import SwiftUI

@main
struct BigTunaLightsWatchApp: App {
    init() {
        #if canImport(WatchConnectivity)
        WatchLightConnectivity.shared.activate()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            WatchLightsView()
        }
    }
}
