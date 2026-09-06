import SwiftUI
import WidgetKit

struct LightWidgetEntry: TimelineEntry {
    let date: Date
    let status: LightWidgetStatus
}

enum LightWidgetStatus {
    case confirmed(LightState)
    case stale(physicalOn: Bool, updatedAt: String?)
    case unavailable(message: String)

    var physicalOn: Bool? {
        switch self {
        case .confirmed(let state): return state.physicalOn
        case .stale(let physicalOn, _): return physicalOn
        case .unavailable: return nil
        }
    }

    var isConfirmed: Bool {
        if case .confirmed = self { return true }
        return false
    }
}

struct LightTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> LightWidgetEntry {
        LightWidgetEntry(date: .now, status: cachedStatus())
    }

    func getSnapshot(in context: Context, completion: @escaping (LightWidgetEntry) -> Void) {
        completion(LightWidgetEntry(date: .now, status: cachedStatus()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LightWidgetEntry>) -> Void) {
        Task {
            let entry = LightWidgetEntry(date: .now, status: await refreshedStatus())
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }

    private func cachedStatus() -> LightWidgetStatus {
        guard let physicalOn = SharedSettings.lastPhysicalOn else {
            return .unavailable(message: SharedSettings.sessionToken == nil ? "Open Yannick Lights to sign in." : "Light state unavailable.")
        }
        return .stale(physicalOn: physicalOn, updatedAt: SharedSettings.lastUpdatedAt)
    }

    private func refreshedStatus() async -> LightWidgetStatus {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else { return cachedStatus() }
        do {
            let state = try await LightService.shared.getCurrentLightState(token: token)
            return .confirmed(state)
        } catch BigTunaLightsAPIError.notAuthenticated {
            SharedSettings.clearSession()
            return .unavailable(message: "Session expired. Open Yannick Lights.")
        } catch {
            return cachedStatus()
        }
    }
}

struct BigTunaLightsWidgetView: View {
    let entry: LightWidgetEntry
    @Environment(\.widgetFamily) private var family

    private var physicalOn: Bool? { entry.status.physicalOn }
    private var isOn: Bool { physicalOn == true }
    private var canControl: Bool { entry.status.isConfirmed && SharedSettings.canControlLight }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Image(systemName: lightSymbol)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(physicalOn == nil ? .secondary : (isOn ? .yellow : .secondary))
                    .accessibilityLabel("Yannick Lights")
                Spacer(minLength: 8)
                statusPill
            }
            Spacer(minLength: family == .systemSmall ? 8 : 14)
            Text(statusTitle)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.primary)
            Text(detailText)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .padding(.top, 2)
            Spacer(minLength: 8)
            if canControl {
                Button(intent: ToggleLightIntent(targetPhysicalOn: !isOn)) {
                    Label(isOn ? "Turn Off" : "Turn On", systemImage: isOn ? "power" : "lightbulb.fill")
                        .font(.caption.weight(.bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(isOn ? Color.yellow.opacity(0.22) : Color.primary.opacity(0.09), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isOn ? "Turn lights off" : "Turn lights on")
                .accessibilityHint("Controls the physical light without opening the app")
            } else {
                Label(unavailableActionText, systemImage: "exclamationmark.circle")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding()
        .containerBackground(for: .widget) { Color(uiColor: .secondarySystemBackground) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Yannick Lights, \(statusTitle.lowercased())")
        .accessibilityValue(accessibilityValue)
    }

    private var statusPill: some View {
        Text(statusTitle)
            .font(.caption2.weight(.bold))
            .foregroundStyle(physicalOn == nil ? .secondary : (isOn ? Color.yellow : .secondary))
            .padding(.horizontal, 7).padding(.vertical, 4)
            .background((physicalOn == nil ? Color.secondary : (isOn ? Color.yellow : Color.secondary)).opacity(0.15), in: Capsule())
            .accessibilityHidden(true)
    }

    private var detailText: String {
        switch entry.status {
        case .confirmed(let state): state.recentlyPolled ? "Verified just now" : "Relay may be offline"
        case .stale(_, let updatedAt): updatedAt.map { "Last verified \($0)" } ?? "Last verified state"
        case .unavailable(let message): message
        }
    }

    private var unavailableActionText: String {
        switch entry.status {
        case .stale: "Refreshes when available"
        case .unavailable: "Open app to continue"
        case .confirmed: ""
        }
    }

    private var accessibilityValue: String {
        switch entry.status {
        case .confirmed: "Verified \(isOn ? "on" : "off")"
        case .stale: "Last confirmed \(isOn ? "on" : "off"); data may be stale"
        case .unavailable(let message): "State unavailable. \(message)"
        }
    }

    private var statusTitle: String {
        guard physicalOn != nil else { return "UNKNOWN" }
        return isOn ? "ON" : "OFF"
    }

    private var lightSymbol: String {
        guard physicalOn != nil else { return "lightbulb.slash" }
        return isOn ? "lightbulb.fill" : "lightbulb"
    }
}

struct BigTunaLightsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "YannickLights.Light", provider: LightTimelineProvider()) { entry in
            BigTunaLightsWidgetView(entry: entry)
        }
        .configurationDisplayName("Yannick Lights")
        .description("Check and control Yannick's light.")
        .supportedFamilies([.systemSmall])
    }
}
