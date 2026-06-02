import AppIntents
import WidgetKit

struct ToggleLightIntent: AppIntent {
    static var title: LocalizedStringResource = "Flick Light"
    static var description = IntentDescription("Toggles the BIG TUNA light.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else {
            throw BigTunaLightsAPIError.notAuthenticated
        }

        let state = try await BigTunaLightsAPI.togglePhysicalLight(token: token)
        SharedSettings.saveLastState(state)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
