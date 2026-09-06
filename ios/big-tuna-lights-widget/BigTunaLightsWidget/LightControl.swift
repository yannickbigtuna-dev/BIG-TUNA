import AppIntents
import SwiftUI
import WidgetKit

/// iOS 18 Control Center control. Its intent performs a direct, authenticated
/// HTTPS mutation and stays out of the foreground app.
@available(iOS 18.0, *)
struct BigTunaLightsControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "YannickLightsControl", provider: LightsControlValueProvider()) { isOn in
            ControlWidgetToggle("Yannick Lights", isOn: isOn, action: SetControlLightIntent()) { targetPhysicalOn in
                Label(targetPhysicalOn ? "Lights On" : "Lights Off", systemImage: targetPhysicalOn ? "lightbulb.fill" : "lightbulb")
            }
        }
        .displayName("Yannick Lights")
        .description("Turn Yannick's light on or off.")
    }
}

@available(iOS 18.0, *)
struct LightsControlValueProvider: ControlValueProvider {
    var previewValue: Bool { SharedSettings.lastPhysicalOn ?? false }

    func currentValue() async throws -> Bool {
        guard let token = SharedSettings.sessionToken, SharedSettings.canControlLight else {
            throw BigTunaLightsAPIError.notAuthenticated
        }
        return (try await LightService.shared.getCurrentLightState(token: token)).physicalOn
    }
}
