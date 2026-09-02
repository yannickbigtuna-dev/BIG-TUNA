import SwiftUI
import WidgetKit

struct LightEntry: TimelineEntry {
    let date: Date
    let status: LightWidgetStatus
}

enum LightWidgetStatus {
    case ready(LightState)
    case stale(physicalOn: Bool, updatedAt: String?)
    case unavailable(String)
}

struct LightTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> LightEntry {
        LightEntry(date: .now, status: cachedStatus())
    }

    func getSnapshot(in context: Context, completion: @escaping (LightEntry) -> Void) {
        completion(LightEntry(date: .now, status: cachedStatus()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LightEntry>) -> Void) {
        Task {
            let entry = LightEntry(date: .now, status: await fetchStatus())
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }

    private func cachedStatus() -> LightWidgetStatus {
        if let physicalOn = SharedSettings.lastPhysicalOn {
            return .stale(physicalOn: physicalOn, updatedAt: SharedSettings.lastUpdatedAt)
        }
        return .unavailable(SharedSettings.sessionToken == nil ? "Sign in in the app." : "Checking light state…")
    }

    private func fetchStatus() async -> LightWidgetStatus {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else { return cachedStatus() }
        do {
            let state = try await BigTunaLightsAPI.fetchState(token: token)
            SharedSettings.saveLastState(state)
            return .ready(state)
        } catch BigTunaLightsAPIError.notAuthenticated {
            SharedSettings.clearSession()
            return .unavailable("Session expired. Open the app.")
        } catch {
            return cachedStatus()
        }
    }
}

struct BigTunaLightsWidgetView: View {
    let entry: LightEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: physicalOn ? "lightbulb.fill" : "lightbulb")
                    .font(.title2.weight(.bold))
                Spacer()
                if canControl {
                    Button(intent: ToggleLightIntent(targetPhysicalOn: !physicalOn)) {
                        Image(systemName: physicalOn ? "power.circle.fill" : "power.circle")
                            .font(.title2.weight(.bold))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(physicalOn ? "Turn lights off" : "Turn lights on")
                }
            }
            Spacer(minLength: 0)
            Text(physicalOn ? "Light On" : "Light Off")
                .font(.headline.weight(.bold))
                .lineLimit(1)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .containerBackground(for: .widget) {
            LinearGradient(
                colors: physicalOn ? [.yellow.opacity(0.65), .orange.opacity(0.32)] : [.black.opacity(0.92), .gray.opacity(0.45)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .accessibilityElement(children: .contain)
    }

    private var physicalOn: Bool {
        switch entry.status {
        case .ready(let state): return state.physicalOn
        case .stale(let physicalOn, _): return physicalOn
        case .unavailable: return false
        }
    }

    private var canControl: Bool {
        if case .ready = entry.status { return SharedSettings.canControlLight }
        return false
    }

    private var detail: String {
        switch entry.status {
        case .ready(let state):
            return state.recentlyPolled ? "Tap to toggle" : "Relay not recently active"
        case .stale:
            return "Last confirmed state"
        case .unavailable(let message):
            return message
        }
    }
}

struct BigTunaLightsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BigTunaLightsWidget", provider: LightTimelineProvider()) { entry in
            BigTunaLightsWidgetView(entry: entry)
        }
        .configurationDisplayName("BIG TUNA Lights")
        .description("Shows and controls the BIG TUNA light.")
        .supportedFamilies([.systemSmall])
    }
}

@available(iOS 18.0, *)
struct BigTunaLightsControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "BigTunaLightsControl", provider: LightsControlValueProvider()) { isOn in
            ControlWidgetToggle("BIG TUNA Lights", isOn: isOn, action: SetControlLightIntent()) { targetPhysicalOn in
                Label(targetPhysicalOn ? "Lights On" : "Lights Off", systemImage: targetPhysicalOn ? "lightbulb.fill" : "lightbulb")
            }
        }
        .displayName("BIG TUNA Lights")
        .description("Turn the BIG TUNA light on or off.")
    }
}

@available(iOS 18.0, *)
struct LightsControlValueProvider: ControlValueProvider {
    var previewValue: Bool { SharedSettings.lastPhysicalOn ?? false }

    func currentValue() async throws -> Bool {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else {
            throw BigTunaLightsAPIError.notAuthenticated
        }
        let state = try await BigTunaLightsAPI.fetchState(token: token)
        SharedSettings.saveLastState(state)
        return state.physicalOn
    }
}
