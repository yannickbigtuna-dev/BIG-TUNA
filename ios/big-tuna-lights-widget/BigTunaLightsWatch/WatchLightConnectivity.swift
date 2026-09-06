import Foundation
import WatchConnectivity
import WidgetKit

/// Watch-app-only receiver for the latest scoped session and confirmed cache.
/// Keeping this out of the WidgetKit extension preserves extension-safe target
/// membership; widgets read the resulting App Group snapshot and use HTTPS.
final class WatchLightConnectivity: NSObject, WCSessionDelegate {
    static let shared = WatchLightConnectivity()

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        WatchLightStore.applyPhoneContext(session.receivedApplicationContext)
        WidgetCenter.shared.reloadAllTimelines()
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        WatchLightStore.applyPhoneContext(applicationContext)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
