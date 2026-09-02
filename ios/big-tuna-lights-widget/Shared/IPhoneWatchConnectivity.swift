import Foundation

#if canImport(WatchConnectivity)
import WatchConnectivity

/// The iPhone owns provisioning of the Watch's revocable session and last
/// authoritative state. `updateApplicationContext` keeps only the newest
/// snapshot, which is ideal for a single light and avoids a command queue.
final class IPhoneWatchConnectivity: NSObject, WCSessionDelegate {
    static let shared = IPhoneWatchConnectivity()

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func publishCurrentContext() {
        guard WCSession.isSupported(), SharedSettings.isAppGroupAvailable else { return }
        var context: [String: Any] = [
            "sessionToken": SharedSettings.sessionToken ?? "",
            "username": SharedSettings.username ?? "",
            "recentlyPolled": SharedSettings.lastRecentlyPolled
        ]
        if let physicalOn = SharedSettings.lastPhysicalOn,
           let updatedAt = SharedSettings.lastUpdatedAt,
           let revision = SharedSettings.lastRevision {
            context["lastPhysicalOn"] = physicalOn
            context["lastUpdatedAt"] = updatedAt
            context["revision"] = revision
            if let reportedPhysicalOn = SharedSettings.lastReportedPhysicalOn {
                context["reportedPhysicalOn"] = reportedPhysicalOn
            }
        }
        do { try WCSession.default.updateApplicationContext(context) }
        catch { /* The next confirmed state/login will retry with a full snapshot. */ }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if error == nil { publishCurrentContext() }
    }

    func sessionDidBecomeInactive(_ session: WCSession) { }

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
#else
struct IPhoneWatchConnectivity {
    static let shared = IPhoneWatchConnectivity()
    func activate() { }
    func publishCurrentContext() { }
}
#endif
