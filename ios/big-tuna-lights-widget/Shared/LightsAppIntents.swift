import AppIntents

/// Discoverable Shortcuts/Siri actions. Widget and control specific intents
/// remain in their extension so each target can describe its own UI surface.
struct TurnLightsOnIntent: AppIntent {
    static var title: LocalizedStringResource = "Turn Yannick Lights On"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else { throw BigTunaLightsAPIError.notAuthenticated }
        _ = try await LightService.shared.setLightState(true, token: token)
        return .result()
    }
}

struct TurnLightsOffIntent: AppIntent {
    static var title: LocalizedStringResource = "Turn Yannick Lights Off"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else { throw BigTunaLightsAPIError.notAuthenticated }
        _ = try await LightService.shared.setLightState(false, token: token)
        return .result()
    }
}

struct ToggleYannickLightsIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Yannick Lights"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else { throw BigTunaLightsAPIError.notAuthenticated }
        _ = try await LightService.shared.toggleLight(token: token)
        return .result()
    }
}

struct GetLightStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Yannick Lights Status"
    static var openAppWhenRun = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else { throw BigTunaLightsAPIError.notAuthenticated }
        let state = try await LightService.shared.getCurrentLightState(token: token)
        return .result(dialog: state.physicalOn ? "Yannick Lights are on." : "Yannick Lights are off.")
    }
}
