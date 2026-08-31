import SwiftUI

struct ContentView: View {
    @AppStorage("factory.lastSync") private var lastSync = "Never"

    var body: some View {
        NavigationStack {
            List {
                Section(FactoryAppConfiguration.name) {
                    Text("Version \(FactoryAppConfiguration.version) (\(FactoryAppConfiguration.build))")
                    Text("Offline-first template ready for app-specific features.")
                }
                Section("Synchronization") {
                    Text("Last sync: \(lastSync)")
                    Button("Record local sync") {
                        lastSync = Date.now.formatted(date: .abbreviated, time: .shortened)
                    }
                }
            }
            .navigationTitle(FactoryAppConfiguration.name)
        }
    }
}
