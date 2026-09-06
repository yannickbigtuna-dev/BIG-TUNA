import SwiftUI

@main
struct BigTunaLightsWatchApp: App {
    init() {
        #if canImport(WatchConnectivity)
        WatchLightConnectivity.shared.activate()
        #endif
        YannickLightsWatchShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup {
            WatchLightsView()
        }
    }
}
