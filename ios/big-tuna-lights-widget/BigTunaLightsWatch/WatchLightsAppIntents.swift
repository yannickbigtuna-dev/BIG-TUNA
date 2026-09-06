import AppIntents
import WidgetKit

/// Watch-native Shortcuts/Siri actions. They share the same least-privilege
/// token, command serialization, verification, and cache as the Watch UI.
struct TurnYannickLightsOnIntent: AppIntent {
    static var title: LocalizedStringResource = "Turn Yannick Lights On"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let state = try await WatchIntentLightAction.set(true)
        return .result(dialog: "Yannick Lights are \(state.physicalOn ? "on" : "off").")
    }
}

struct TurnYannickLightsOffIntent: AppIntent {
    static var title: LocalizedStringResource = "Turn Yannick Lights Off"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let state = try await WatchIntentLightAction.set(false)
        return .result(dialog: "Yannick Lights are \(state.physicalOn ? "on" : "off").")
    }
}

struct ToggleYannickLightsIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Yannick Lights"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let state = try await WatchIntentLightAction.toggle()
        return .result(dialog: "Yannick Lights are \(state.physicalOn ? "on" : "off").")
    }
}

struct GetYannickLightsStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Yannick Lights Status"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard WatchLightStore.canControl, let token = WatchLightStore.token else { throw WatchLightAPIError.notAuthenticated }
        let state = try await WatchLightAPI.fetchState(token: token)
        WatchLightStore.save(state)
        return .result(dialog: "Yannick Lights are \(state.physicalOn ? "on" : "off").")
    }
}

enum WatchIntentLightAction {
    static func set(_ physicalOn: Bool) async throws -> WatchLightState {
        guard WatchLightStore.canControl, let token = WatchLightStore.token else { throw WatchLightAPIError.notAuthenticated }
        let result = try await WatchLightCommandCoordinator.shared.set(physicalOn, token: token)
        let state = result.state
        WatchLightStore.save(state)
        WidgetCenter.shared.reloadAllTimelines()
        return state
    }

    static func toggle() async throws -> WatchLightState {
        guard WatchLightStore.canControl, let token = WatchLightStore.token else { throw WatchLightAPIError.notAuthenticated }
        let result = try await WatchLightCommandCoordinator.shared.toggle(token: token)
        let state = result.state
        WatchLightStore.save(state)
        WidgetCenter.shared.reloadAllTimelines()
        return state
    }
}

struct YannickLightsWatchShortcuts: AppShortcutsProvider {
    static var shortcutTileColor: ShortcutTileColor = .orange
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: TurnYannickLightsOnIntent(), phrases: ["Turn on \(.applicationName)"], shortTitle: "Lights On", systemImageName: "lightbulb.fill")
        AppShortcut(intent: TurnYannickLightsOffIntent(), phrases: ["Turn off \(.applicationName)"], shortTitle: "Lights Off", systemImageName: "lightbulb")
        AppShortcut(intent: ToggleYannickLightsIntent(), phrases: ["Toggle \(.applicationName)"], shortTitle: "Toggle Lights", systemImageName: "power")
        AppShortcut(intent: GetYannickLightsStatusIntent(), phrases: ["Get \(.applicationName) status"], shortTitle: "Light Status", systemImageName: "lightbulb")
    }
}
