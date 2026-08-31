import SwiftUI

@main
struct FactoryWatchApp: App {
    init() {
#if canImport(WatchConnectivity)
        FactoryWatchConnectivity.shared.activate()
#endif
    }
    var body: some Scene { WindowGroup { FactoryWatchContentView() } }
}

struct FactoryWatchContentView: View {
    var body: some View {
        VStack {
            Text(FactoryAppConfiguration.name).font(.headline)
            Text("Ready offline").foregroundStyle(.secondary)
        }.padding()
    }
}
