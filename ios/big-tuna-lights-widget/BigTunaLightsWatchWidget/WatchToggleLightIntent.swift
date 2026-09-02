import AppIntents
import WidgetKit

struct SetWatchLightIntent: SetValueIntent {
    static var title: LocalizedStringResource = "Set BIG TUNA Lights"
    static var description = IntentDescription("Sets the BIG TUNA light to an explicit on or off state.")
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
        let state = try await WatchLightAPI.setPhysicalLight(on: value, token: token)
        WatchLightStore.save(state)
        WidgetCenter.shared.reloadAllTimelines()
        if #available(watchOS 26.0, *) {
            ControlCenter.shared.reloadControls(ofKind: "BigTunaLightsWatchControl")
        }
        return .result()
    }
}
