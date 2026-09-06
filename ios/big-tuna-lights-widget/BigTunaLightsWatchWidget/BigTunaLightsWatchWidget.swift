import AppIntents
import SwiftUI
import WidgetKit

struct WatchLightTimelineEntry: TimelineEntry { let date: Date; let availability: WatchLightAvailability }
struct WatchLightTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchLightTimelineEntry { .init(date: .now, availability: cachedAvailability()) }
    func getSnapshot(in context: Context, completion: @escaping (WatchLightTimelineEntry) -> Void) { completion(.init(date: .now, availability: cachedAvailability())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchLightTimelineEntry>) -> Void) {
        Task {
            let availability: WatchLightAvailability
            if WatchLightStore.canControl, let token = WatchLightStore.token {
                do { let state = try await WatchLightAPI.fetchState(token: token); WatchLightStore.save(state); availability = state.hasConfirmedDesiredState ? .ready(state) : .stale(state) }
                catch { availability = WatchLightStore.cachedState.map { .stale($0) } ?? .offline(error.localizedDescription) }
            } else { availability = WatchLightStore.cachedState.map { .stale($0) } ?? .signedOut }
            completion(Timeline(entries: [.init(date: .now, availability: availability)], policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }
    private func cachedAvailability() -> WatchLightAvailability {
        guard WatchLightStore.canControl else { return WatchLightStore.cachedState.map { .stale($0) } ?? .signedOut }
        guard let state = WatchLightStore.cachedState else { return .offline("No confirmed state") }
        return state.hasConfirmedDesiredState ? .ready(state) : .stale(state)
    }
}

/// accessoryRectangular is a Smart Stack family and uses a modern App Intent.
/// Small complications use Apple's legitimate tap-to-open behavior instead.
struct WatchLightStatusView: View {
    let entry: WatchLightTimelineEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        Group {
            if family == .accessoryRectangular, case .ready(let state) = entry.availability {
                Button(intent: SetWatchLightIntent(value: !state.physicalOn)) { lightContent }.buttonStyle(.plain)
            } else { lightContent }
        }
        .widgetURL(URL(string: "bigtunalights://light"))
        .accessibilityLabel(label).accessibilityValue(detail)
    }
    @ViewBuilder private var lightContent: some View {
        switch family {
        case .accessoryCircular: Image(systemName: iconName).widgetLabel(label)
        case .accessoryRectangular:
            HStack { Image(systemName: iconName).font(.title2.weight(.semibold)); VStack(alignment: .leading) { Text(label).font(.headline); Text(detail).font(.caption2).lineLimit(1) } }
        case .accessoryInline: Label(label, systemImage: iconName)
        default: Label(label, systemImage: iconName)
        }
    }
    private var state: WatchLightState? { entry.availability.state }
    private var iconName: String { state?.physicalOn == true ? "lightbulb.fill" : "lightbulb" }
    private var label: String { switch entry.availability { case .ready(let state): return state.physicalOn ? "Lights On" : "Lights Off"; case .stale: return "Lights Stale"; case .signedOut: return "Lights Sign In"; case .offline: return "Lights Offline" } }
    private var detail: String { switch entry.availability { case .ready(let state): return state.recentlyPolled ? "Tap to toggle" : "Status needs refresh"; case .stale: return "Last confirmed state"; case .signedOut: return "Sign in on iPhone"; case .offline(let message): return message } }
}

struct BigTunaLightsWatchStatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BigTunaLightsWatchStatus", provider: WatchLightTimelineProvider()) { WatchLightStatusView(entry: $0) }
            .configurationDisplayName("Yannick Lights").description("Shows the light status and toggles from Smart Stack when available.")
            .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct WatchScoreTimelineEntry: TimelineEntry { let date: Date; let score: WatchWeeklyScore }
struct WatchScoreTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchScoreTimelineEntry { .init(date: .now, score: WatchWeeklyScore.cached ?? .unavailable) }
    func getSnapshot(in context: Context, completion: @escaping (WatchScoreTimelineEntry) -> Void) { completion(placeholder(in: context)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchScoreTimelineEntry>) -> Void) {
        Task {
            let score: WatchWeeklyScore
            do { score = try await WatchScoreAPI.fetchCurrentWeeklyScore(); WatchWeeklyScore.save(score) }
            catch { score = (WatchWeeklyScore.cached ?? .unavailable).withStale(true) }
            completion(Timeline(entries: [.init(date: .now, score: score)], policy: .after(.now.addingTimeInterval(30 * 60))))
        }
    }
}

/// Names and numerals remain meaningful independent of red and blue accents.
struct WatchScoreWidgetView: View {
    let entry: WatchScoreTimelineEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        Group {
            switch family {
            case .accessoryRectangular:
                HStack(spacing: 7) { scoreSide("YANNICK", entry.score.yannickScore, .red, .leading); Text("-").font(.headline).foregroundStyle(.secondary); scoreSide("EMMA", entry.score.emmaScore, .blue, .trailing) }
            case .accessoryCircular:
                VStack(spacing: 0) { Text("Y-E").font(.caption2.weight(.bold)); Text(compactScore).font(.caption.weight(.bold)).monospacedDigit() }
            case .accessoryInline: Text(inlineScore)
            default: Text(inlineScore)
            }
        }
        .widgetURL(URL(string: "bigtunalights://score"))
        .accessibilityLabel("Yannick versus Emma weekly score")
        .accessibilityValue(entry.score.isAvailable
            ? "Yannick \(entry.score.yannickScore!), Emma \(entry.score.emmaScore!). \(entry.score.leaderDescription)."
            : "Score unavailable.")
    }
    private var compactScore: String {
        guard let yannick = entry.score.yannickScore, let emma = entry.score.emmaScore else { return "-" }
        return "\(yannick)-\(emma)"
    }
    private var inlineScore: String {
        guard let yannick = entry.score.yannickScore, let emma = entry.score.emmaScore else { return "Score unavailable" }
        return "Y \(yannick)-\(emma) E"
    }
    private func scoreSide(_ name: String, _ score: Int?, _ tint: Color, _ alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 0) { Text(name).font(.caption2.weight(.bold)).foregroundStyle(tint); Text(score.map { String($0) } ?? "-").font(.title2.weight(.bold)).monospacedDigit() }.frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
    }
}

struct BigTunaLightsWatchScoreWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BigTunaLightsWatchScore", provider: WatchScoreTimelineProvider()) { WatchScoreWidgetView(entry: $0) }
            .configurationDisplayName("Yannick vs Emma").description("Current weekly Yannick versus Emma score.")
            .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@available(watchOS 26.0, *)
struct YannickLightsWatchControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "YannickLightsWatchControl", provider: WatchLightControlValueProvider()) { isOn in
            ControlWidgetToggle("Yannick Lights", isOn: isOn, action: SetWatchLightIntent()) { value in Label(value ? "Lights On" : "Lights Off", systemImage: value ? "lightbulb.fill" : "lightbulb") }
        }.displayName("Yannick Lights").description("Turns Yannick Lights on or off without opening the app.")
    }
}

@available(watchOS 26.0, *)
struct WatchLightControlValueProvider: ControlValueProvider {
    var previewValue: Bool { WatchLightStore.cachedState?.physicalOn ?? false }
    func currentValue() async throws -> Bool {
        guard WatchLightStore.isAppGroupAvailable, WatchLightStore.canControl, let token = WatchLightStore.token else { throw WatchLightAPIError.notAuthenticated }
        let state = try await WatchLightAPI.fetchState(token: token)
        guard state.hasConfirmedDesiredState else { throw WatchLightAPIError.server("No confirmed light state.") }
        WatchLightStore.save(state); return state.physicalOn
    }
}
