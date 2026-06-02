import SwiftUI
import WidgetKit

struct LightEntry: TimelineEntry {
    let date: Date
    let status: LightWidgetStatus
}

enum LightWidgetStatus {
    case ready(physicalOn: Bool, updatedAt: String?, canControl: Bool)
    case unavailable(String)
}

struct LightTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> LightEntry {
        LightEntry(
            date: Date(),
            status: .ready(
                physicalOn: SharedSettings.lastPhysicalOn ?? false,
                updatedAt: nil,
                canControl: SharedSettings.canControlLight
            )
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (LightEntry) -> Void) {
        completion(LightEntry(date: Date(), status: snapshotStatus()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LightEntry>) -> Void) {
        Task {
            let status = await fetchStatus()
            let entry = LightEntry(date: Date(), status: status)
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(60))))
        }
    }

    private func snapshotStatus() -> LightWidgetStatus {
        .ready(
            physicalOn: SharedSettings.lastPhysicalOn ?? false,
            updatedAt: SharedSettings.lastUpdatedAt,
            canControl: SharedSettings.canControlLight
        )
    }

    private func fetchStatus() async -> LightWidgetStatus {
        do {
            let state = try await BigTunaLightsAPI.fetchState()
            SharedSettings.saveLastState(state)
            return .ready(
                physicalOn: state.physicalOn,
                updatedAt: state.updatedAt,
                canControl: SharedSettings.canControlLight
            )
        } catch {
            if let cached = SharedSettings.lastPhysicalOn {
                return .ready(
                    physicalOn: cached,
                    updatedAt: SharedSettings.lastUpdatedAt,
                    canControl: SharedSettings.canControlLight
                )
            }
            return .unavailable(error.localizedDescription)
        }
    }
}

struct BigTunaLightsWidgetView: View {
    let entry: LightEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: iconName)
                    .font(.title2.weight(.semibold))
                Spacer()
                if isReady {
                    Button(intent: ToggleLightIntent()) {
                        Image(systemName: "power")
                            .font(.headline.weight(.bold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(buttonTint)
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(family == .systemSmall ? .title3.weight(.bold) : .title.weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)

                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .containerBackground(for: .widget) {
            LinearGradient(colors: backgroundColors, startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    private var isReady: Bool {
        if case .ready(_, _, let canControl) = entry.status {
            return canControl
        }
        return false
    }

    private var physicalOn: Bool {
        if case .ready(let physicalOn, _, _) = entry.status {
            return physicalOn
        }
        return false
    }

    private var iconName: String {
        physicalOn ? "lightbulb.fill" : "lightbulb"
    }

    private var title: String {
        switch entry.status {
        case .ready(let physicalOn, _, _):
            return physicalOn ? "Light On" : "Light Off"
        case .unavailable:
            return "Unavailable"
        }
    }

    private var detail: String {
        switch entry.status {
        case .ready(_, _, let canControl):
            if canControl {
                return "Tap power to flick"
            }
            if SharedSettings.sessionToken == nil {
                return "Open the app to sign in."
            }
            return "Use the yannick account."
        case .unavailable(let message):
            return message
        }
    }

    private var buttonTint: Color {
        physicalOn ? .orange : .blue
    }

    private var backgroundColors: [Color] {
        if physicalOn {
            return [Color.yellow.opacity(0.65), Color.orange.opacity(0.35)]
        }
        return [Color.black.opacity(0.88), Color.gray.opacity(0.45)]
    }
}

struct BigTunaLightsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BigTunaLightsWidget", provider: LightTimelineProvider()) { entry in
            BigTunaLightsWidgetView(entry: entry)
        }
        .configurationDisplayName("BIG TUNA Lights")
        .description("Flick the BIG TUNA light on or off.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
