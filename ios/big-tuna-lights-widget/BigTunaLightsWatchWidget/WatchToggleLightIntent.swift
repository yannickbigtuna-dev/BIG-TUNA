import AppIntents
import WidgetKit

struct SetWatchLightIntent: SetValueIntent {
    static var title: LocalizedStringResource = "Set Yannick Lights"
    static var description = IntentDescription("Sets Yannick Lights to an explicit on or off state.")
    static var openAppWhenRun = false

    @Parameter(title: "Lights On") var value: Bool

    init() {}

    init(value: Bool) {
        self.value = value
    }

    func perform() async throws -> some IntentResult {
        guard WatchLightStore.isAppGroupAvailable else {
            throw WatchLightAPIError.server("Shared Lights storage is unavailable.")
        }
        guard WatchLightStore.canControl, let token = WatchLightStore.token else {
            throw WatchLightAPIError.notAuthenticated
        }
        guard let cached = WatchLightStore.cachedState, cached.hasConfirmedDesiredState else {
            throw WatchLightAPIError.server("Refresh a confirmed state before controlling.")
        }
        let result = try await WatchLightCommandCoordinator.shared.set(value, token: token)
        WatchLightStore.save(result.state)
        WidgetCenter.shared.reloadAllTimelines()
        if #available(watchOS 26.0, *) {
            ControlCenter.shared.reloadControls(ofKind: "YannickLightsWatchControl")
        }
        return .result()
    }
}
