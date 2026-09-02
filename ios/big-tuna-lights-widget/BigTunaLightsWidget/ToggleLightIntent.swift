import AppIntents
import WidgetKit

/// Used by the Home Screen widget and Control Center. It deliberately carries
/// a physical target value rather than asking the server to "toggle".
struct ToggleLightIntent: AppIntent {
    static var title: LocalizedStringResource = "Set BIG TUNA Lights"
    static var description = IntentDescription("Sets the BIG TUNA light to the selected state.")
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
        let state = try await BigTunaLightsAPI.setPhysicalLight(
            on: targetPhysicalOn,
            token: token,
            commandId: UUID()
        )
        SharedSettings.saveLastState(state)
        IPhoneWatchConnectivity.shared.publishCurrentContext()
        WidgetCenter.shared.reloadAllTimelines()
        if #available(iOS 18.0, *) { ControlCenter.shared.reloadControls(ofKind: "BigTunaLightsControl") }
        return .result()
    }
}

@available(iOS 18.0, *)
struct SetControlLightIntent: SetValueIntent {
    static var title: LocalizedStringResource = "Set BIG TUNA Lights"
    static var openAppWhenRun = false

    @Parameter(title: "Turn lights on") var value: Bool

    init() { value = false }
    init(value: Bool) { self.value = value }

    func perform() async throws -> some IntentResult {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else {
            throw BigTunaLightsAPIError.notAuthenticated
        }
        let state = try await BigTunaLightsAPI.setPhysicalLight(on: value, token: token, commandId: UUID())
        SharedSettings.saveLastState(state)
        IPhoneWatchConnectivity.shared.publishCurrentContext()
        WidgetCenter.shared.reloadAllTimelines()
        ControlCenter.shared.reloadControls(ofKind: "BigTunaLightsControl")
        return .result()
    }
}
