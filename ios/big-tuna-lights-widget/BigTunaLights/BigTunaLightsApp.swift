import SwiftUI

@main
struct BigTunaLightsApp: App {
    init() {
        IPhoneWatchConnectivity.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
