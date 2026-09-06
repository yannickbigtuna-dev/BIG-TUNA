import Foundation
import WidgetKit

enum LightVerification: Equatable, Sendable {
    case verified
    case unavailable
}

struct LightOperationResult: Equatable, Sendable {
    let state: LightState
    let verification: LightVerification
}

/// One serialized coordinator for all in-process native light commands.
/// Commands always contain an explicit physical target and a stable idempotency
/// identifier; cache writes occur only after a successful server response.
actor LightService {
    static let shared = LightService()

    func getCurrentLightState(token: String) async throws -> LightState {
        let state = try await BigTunaLightsAPI.fetchState(token: token)
        SharedSettings.saveLastState(state)
        return state
    }

    func setLightState(_ physicalOn: Bool, token: String, commandID: UUID = UUID()) async throws -> LightOperationResult {
        let confirmed = try await BigTunaLightsAPI.setPhysicalLight(on: physicalOn, token: token, commandId: commandID)
        SharedSettings.saveLastState(confirmed)
        let verification: LightVerification
        do {
            let reconciled = try await BigTunaLightsAPI.fetchState(token: token)
            SharedSettings.saveLastState(reconciled)
            reloadSystemSurfaces()
            return LightOperationResult(state: reconciled, verification: .verified)
        } catch {
            // The explicit PUT already succeeded and its body is authoritative.
            // A failed follow-up read (including an expired session immediately
            // afterward) must not make the UI pretend the command failed.
            verification = .unavailable
        }
        reloadSystemSurfaces()
        return LightOperationResult(state: confirmed, verification: verification)
    }

    func toggleLight(token: String) async throws -> LightOperationResult {
        let state = try await getCurrentLightState(token: token)
        return try await setLightState(!state.physicalOn, token: token)
    }

    private func reloadSystemSurfaces() {
        WidgetCenter.shared.reloadAllTimelines()
        #if os(iOS)
        if #available(iOS 18.0, *) { ControlCenter.shared.reloadControls(ofKind: "YannickLightsControl") }
        #endif
    }
}
