import WidgetKit
import SwiftUI

struct FactoryWidgetEntry: TimelineEntry { let date: Date }

struct FactoryWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> FactoryWidgetEntry { .init(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (FactoryWidgetEntry) -> Void) { completion(.init(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<FactoryWidgetEntry>) -> Void) {
        completion(Timeline(entries: [.init(date: .now)], policy: .after(.now.addingTimeInterval(15 * 60))))
    }
}

struct FactoryWidget: Widget {
    let kind = "FactoryWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FactoryWidgetProvider()) { entry in
            VStack(alignment: .leading) {
                Text(FactoryAppConfiguration.name).font(.headline)
                Text(entry.date, style: .time).font(.caption)
            }.containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName(FactoryAppConfiguration.name)
        .description("A configurable Home Screen and Lock Screen widget.")
        .supportedFamilies([.systemSmall, .systemMedium, // LOCK_SCREEN_FAMILIES
        ])
    }
}

@main
struct FactoryWidgetBundle: WidgetBundle {
    var body: some Widget {
        FactoryWidget()
        // LIVE_ACTIVITY_WIDGET
    }
}
