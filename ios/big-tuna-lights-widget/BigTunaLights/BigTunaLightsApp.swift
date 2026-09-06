import SwiftUI

@main
struct BigTunaLightsApp: App {
    init() {
        // The paired Watch receives only a revocable Lights token and confirmed
        // state through WatchConnectivity; no account password leaves the phone.
        IPhoneWatchConnectivity.shared.activate()
        YannickLightsShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
