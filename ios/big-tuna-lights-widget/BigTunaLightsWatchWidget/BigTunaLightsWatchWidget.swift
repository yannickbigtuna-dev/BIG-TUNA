import SwiftUI
import WidgetKit

struct WatchLightTimelineEntry: TimelineEntry {
    let date: Date
    let availability: WatchLightAvailability
}

struct WatchLightTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchLightTimelineEntry {
        WatchLightTimelineEntry(date: .now, availability: cachedAvailability())
    }

    func getSnapshot(in context: Context, completion: @escaping (WatchLightTimelineEntry) -> Void) {
        completion(WatchLightTimelineEntry(date: .now, availability: cachedAvailability()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchLightTimelineEntry>) -> Void) {
        Task {
            let availability: WatchLightAvailability
            guard WatchLightStore.canControl, let token = WatchLightStore.token else {
                availability = WatchLightStore.cachedState.map { .stale($0) } ?? .signedOut
                completion(Timeline(entries: [WatchLightTimelineEntry(date: .now, availability: availability)], policy: .after(.now.addingTimeInterval(15 * 60))))
                return
            }
            do {
                let state = try await WatchLightAPI.fetchState(token: token)
                WatchLightStore.save(state)
                availability = state.hasConfirmedDesiredState ? .ready(state) : .stale(state)
            } catch {
                availability = WatchLightStore.cachedState.map { .stale($0) } ?? .offline(error.localizedDescription)
            }
            completion(Timeline(entries: [WatchLightTimelineEntry(date: .now, availability: availability)], policy: .after(.now.addingTimeInterval(5 * 60))))
        }
    }

    private func cachedAvailability() -> WatchLightAvailability {
        guard WatchLightStore.canControl else {
            return WatchLightStore.cachedState.map { .stale($0) } ?? .signedOut
        }
        guard let state = WatchLightStore.cachedState else { return .offline("No confirmed state") }
        return state.hasConfirmedDesiredState ? .ready(state) : .stale(state)
    }
}

struct WatchLightStatusView: View {
    let entry: WatchLightTimelineEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            Image(systemName: iconName)
                .widgetLabel(label)
        case .accessoryRectangular:
            HStack {
                Image(systemName: iconName).font(.title2)
                VStack(alignment: .leading) {
                    Text(label).font(.headline)
                    Text(detail).font(.caption2).lineLimit(1)
                }
            }
        case .accessoryInline:
            Label(label, systemImage: iconName)
        default:
            Label(label, systemImage: iconName)
        }
    }

    private var state: WatchLightState? { entry.availability.state }
    private var iconName: String { state?.physicalOn == true ? "lightbulb.fill" : "lightbulb" }
    private var label: String {
        switch entry.availability {
        case .ready(let state): return state.physicalOn ? "Lights On" : "Lights Off"
        case .stale: return "Lights Stale"
        case .signedOut: return "Lights Sign In"
        case .offline: return "Lights Offline"
        }
    }
    private var detail: String {
        switch entry.availability {
        case .ready(let state): return state.recentlyPolled ? "Relay confirmed" : "Relay stale"
        case .stale: return "Last confirmed state"
        case .signedOut: return "Sign in on iPhone"
        case .offline(let message): return message
        }
    }
}

struct BigTunaLightsWatchStatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BigTunaLightsWatchStatus", provider: WatchLightTimelineProvider()) { entry in
            WatchLightStatusView(entry: entry)
        }
        .configurationDisplayName("BIG TUNA Lights")
        .description("Shows the confirmed status of the BIG TUNA light.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

/// watchOS 26 exposes controls in Watch Control Center, Smart Stack, and the
/// Apple Watch Ultra Action button. The control deliberately does not deep-link.
@available(watchOS 26.0, *)
struct BigTunaLightsWatchControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "BigTunaLightsWatchControl", provider: WatchLightControlValueProvider()) { isOn in
            ControlWidgetToggle("BIG TUNA Lights", isOn: isOn, action: SetWatchLightIntent()) { isOn in
                Label(isOn ? "Lights On" : "Lights Off", systemImage: isOn ? "lightbulb.fill" : "lightbulb")
            }
        }
        .displayName("BIG TUNA Lights")
        .description("Turns the BIG TUNA light on or off without opening the app.")
    }
}

@available(watchOS 26.0, *)
struct WatchLightControlValueProvider: ControlValueProvider {
    var previewValue: Bool { false }

    func currentValue() async throws -> Bool {
        guard WatchLightStore.isAppGroupAvailable else {
            throw WatchLightAPIError.server("Shared Lights storage is unavailable.")
        }
        guard WatchLightStore.canControl, let token = WatchLightStore.token else {
            throw WatchLightAPIError.notAuthenticated
        }
        let state = try await WatchLightAPI.fetchState(token: token)
        guard state.hasConfirmedDesiredState else {
            throw WatchLightAPIError.server("No confirmed desired light state.")
        }
        WatchLightStore.save(state)
        return state.physicalOn
    }
}
