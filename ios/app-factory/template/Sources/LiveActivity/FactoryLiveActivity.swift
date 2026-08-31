import ActivityKit
import WidgetKit
import SwiftUI

struct FactoryActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable { var status: String }
    var title: String
}

struct FactoryLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FactoryActivityAttributes.self) { context in
            Text(context.state.status).padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) { Text(context.state.status) }
            } compactLeading: { Text("•") } compactTrailing: { Text(context.state.status.prefix(1)) } minimal: { Text("•") }
        }
    }
}
