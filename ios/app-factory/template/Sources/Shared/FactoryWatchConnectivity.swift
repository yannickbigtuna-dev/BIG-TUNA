import Foundation

#if canImport(WatchConnectivity)
import WatchConnectivity

final class FactoryWatchConnectivity: NSObject, WCSessionDelegate {
    static let shared = FactoryWatchConnectivity()

    func activate() {
        guard FactoryAppConfiguration.supportsWatchConnectivity,
              WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func sendQueuedTransferIfPossible() {
        guard FactoryAppConfiguration.supportsWatchConnectivity,
              WCSession.default.activationState == .activated,
              let payload = FactorySharedStore.defaults.data(forKey: "factory.pendingTransfer") else { return }
        WCSession.default.transferUserInfo(["factoryPayload": payload])
        FactorySharedStore.defaults.removeObject(forKey: "factory.pendingTransfer")
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if error == nil { sendQueuedTransferIfPossible() }
    }

#if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
#endif
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        if let payload = userInfo["factoryPayload"] as? Data { FactorySharedStore.queueTransfer(payload) }
    }
}
#endif
