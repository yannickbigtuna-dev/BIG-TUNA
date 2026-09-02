import WidgetKit
import SwiftUI

struct FactoryWatchWidgetEntry: TimelineEntry { let date: Date }

struct FactoryWatchWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> FactoryWatchWidgetEntry { .init(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (FactoryWatchWidgetEntry) -> Void) { completion(.init(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<FactoryWatchWidgetEntry>) -> Void) {
        completion(Timeline(entries: [.init(date: .now)], policy: .after(.now.addingTimeInterval(15 * 60))))
    }
}

struct FactoryWatchWidget: Widget {
    let kind = "FactoryWatchWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FactoryWatchWidgetProvider()) { entry in
            Text(entry.date, style: .time).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName(FactoryAppConfiguration.name)
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct FactoryWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        FactoryWatchWidget()
        // WATCH_CONTROL_WIDGET
    }
}
