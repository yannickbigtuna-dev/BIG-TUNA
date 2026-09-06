import AppIntents
import WidgetKit

/// Used by the Home Screen widget and Control Center. It deliberately carries
/// a physical target value, giving retries a safe idempotent server command.
struct ToggleLightIntent: AppIntent {
    static var title: LocalizedStringResource = "Set Yannick Lights"
    static var description = IntentDescription("Sets Yannick's physical light to the selected state.")
    static var openAppWhenRun = false

    @Parameter(title: "Turn lights on") var targetPhysicalOn: Bool

    init() { targetPhysicalOn = false }

    init(targetPhysicalOn: Bool) {
        self.targetPhysicalOn = targetPhysicalOn
    }

    func perform() async throws -> some IntentResult {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else {
            throw BigTunaLightsAPIError.notAuthenticated
        }
        _ = try await LightService.shared.setLightState(targetPhysicalOn, token: token)
        WidgetCenter.shared.reloadAllTimelines()
        if #available(iOS 18.0, *) { ControlCenter.shared.reloadControls(ofKind: "YannickLightsControl") }
        return .result()
    }
}

@available(iOS 18.0, *)
struct SetControlLightIntent: SetValueIntent {
    static var title: LocalizedStringResource = "Set Yannick Lights"
    static var openAppWhenRun = false

    @Parameter(title: "Turn lights on") var value: Bool

    init() { value = false }
    init(value: Bool) { self.value = value }

    func perform() async throws -> some IntentResult {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else {
            throw BigTunaLightsAPIError.notAuthenticated
        }
        _ = try await LightService.shared.setLightState(value, token: token)
        WidgetCenter.shared.reloadAllTimelines()
        ControlCenter.shared.reloadControls(ofKind: "YannickLightsControl")
        return .result()
    }
}
