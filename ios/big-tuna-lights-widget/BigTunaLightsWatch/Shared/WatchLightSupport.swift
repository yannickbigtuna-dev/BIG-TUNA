import Foundation

struct WatchLightState: Codable, Equatable {
    let physicalOn: Bool
    let reportedPhysicalOn: Bool?
    let recentlyPolled: Bool
    let updatedAt: String
    let revision: String

    /// A desired state returned by the native API is authoritative even when
    /// the relay has not reported a recent physical poll.
    var hasConfirmedDesiredState: Bool {
        !updatedAt.isEmpty && !revision.isEmpty
    }
}

enum WatchLightAvailability: Equatable {
    case ready(WatchLightState)
    case stale(WatchLightState)
    case signedOut
    case offline(String)

    var state: WatchLightState? {
        switch self {
        case .ready(let state), .stale(let state): return state
        case .signedOut, .offline: return nil
        }
    }

    var mayControl: Bool {
        if case .ready = self { return true }
        return false
    }
}

enum WatchLightAPIError: LocalizedError {
    case notAuthenticated
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: return "Sign in on iPhone as yannick."
        case .invalidResponse: return "The light service returned an invalid response."
        case .server(let message): return message
        }
    }
}

/// Shared Watch App Group cache populated only from an authoritative HTTPS
/// response or a WatchConnectivity application-context update sent by the
/// paired iPhone app. It intentionally never records an optimistic target state.
/// The credential is a revocable server session, never an account password.
enum WatchLightStore {
    static let appGroupIdentifier = "group.ca.yannickmorgans.bigtuna.lights"
    private enum Key {
        static let sessionToken = "sessionToken"
        static let username = "username"
        static let lastPhysicalOn = "lastPhysicalOn"
        static let lastUpdatedAt = "lastUpdatedAt"
        static let revision = "revision"
        static let reportedPhysicalOn = "reportedPhysicalOn"
        static let recentlyPolled = "recentlyPolled"
    }

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupIdentifier)
    }

    static var isAppGroupAvailable: Bool {
        defaults != nil
    }

    static var token: String? {
        let value = defaults?.string(forKey: Key.sessionToken) ?? ""
        return value.isEmpty ? nil : value
    }

    static var canControl: Bool {
        token != nil && defaults?.string(forKey: Key.username)?.lowercased() == "yannick"
    }

    static var cachedState: WatchLightState? {
        guard
            let defaults,
            defaults.object(forKey: Key.lastPhysicalOn) != nil,
            let updatedAt = defaults.string(forKey: Key.lastUpdatedAt),
            let revision = defaults.string(forKey: Key.revision)
        else { return nil }
        let reported = defaults.object(forKey: Key.reportedPhysicalOn) == nil
            ? nil : defaults.bool(forKey: Key.reportedPhysicalOn)
        return WatchLightState(
            physicalOn: defaults.bool(forKey: Key.lastPhysicalOn),
            reportedPhysicalOn: reported,
            recentlyPolled: defaults.bool(forKey: Key.recentlyPolled),
            updatedAt: updatedAt,
            revision: revision
        )
    }

    static func save(_ state: WatchLightState) {
        defaults?.set(state.physicalOn, forKey: Key.lastPhysicalOn)
        defaults?.set(state.reportedPhysicalOn, forKey: Key.reportedPhysicalOn)
        defaults?.set(state.recentlyPolled, forKey: Key.recentlyPolled)
        defaults?.set(state.updatedAt, forKey: Key.lastUpdatedAt)
        defaults?.set(state.revision, forKey: Key.revision)
    }

    static func clearSession() {
        defaults?.removeObject(forKey: Key.sessionToken)
        defaults?.removeObject(forKey: Key.username)
    }

    static func applyPhoneContext(_ context: [String: Any]) {
        guard let defaults else { return }
        if let token = context[Key.sessionToken] as? String {
            if token.isEmpty {
                defaults.removeObject(forKey: Key.sessionToken)
            } else {
                defaults.set(token, forKey: Key.sessionToken)
            }
        }
        if let username = context[Key.username] as? String {
            if username.isEmpty {
                defaults.removeObject(forKey: Key.username)
                defaults.removeObject(forKey: Key.sessionToken)
            } else {
                defaults.set(username, forKey: Key.username)
                if username.lowercased() != "yannick" {
                    defaults.removeObject(forKey: Key.sessionToken)
                }
            }
        }
        guard
            let physicalOn = context[Key.lastPhysicalOn] as? Bool,
            let updatedAt = context[Key.lastUpdatedAt] as? String,
            let revision = context[Key.revision] as? String
        else { return }
        save(WatchLightState(
            physicalOn: physicalOn,
            reportedPhysicalOn: context[Key.reportedPhysicalOn] as? Bool,
            recentlyPolled: context[Key.recentlyPolled] as? Bool ?? false,
            updatedAt: updatedAt,
            revision: revision
        ))
    }
}

enum WatchLightAPI {
    private static let endpoint = URL(string: "https://yannickmorgans.ca/api/lights/native/v1")!

    private struct SetLightPayload: Encodable {
        let physicalOn: Bool
        let commandId: String
    }

    static func fetchState(token: String) async throws -> WatchLightState {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return try await send(request)
    }

    static func setPhysicalLight(on physicalOn: Bool, token: String, commandID: UUID = UUID()) async throws -> WatchLightState {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "PUT"
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(
            SetLightPayload(physicalOn: physicalOn, commandId: commandID.uuidString)
        )
        return try await send(request)
    }

    /// A successful command must never be reported as failed just because the
    /// optional reconciliation read is unavailable. Both variants contain a
    /// server-authoritative command response; only the first is freshly read.
    enum SetAndVerifyResult: Equatable {
        case verified(WatchLightState)
        case verificationUnavailable(acknowledged: WatchLightState)

        var state: WatchLightState {
            switch self {
            case .verified(let state), .verificationUnavailable(let state): return state
            }
        }

        var didVerify: Bool {
            if case .verified = self { return true }
            return false
        }
    }

    /// The same idempotent PUT is issued once. Two bounded GET attempts only
    /// reconcile presentation; they never cause a command retry.
    static func setAndVerifyPhysicalLight(on physicalOn: Bool, token: String, commandID: UUID = UUID()) async throws -> SetAndVerifyResult {
        let acknowledged = try await setPhysicalLight(on: physicalOn, token: token, commandID: commandID)
        do {
            return .verified(try await fetchState(token: token))
        } catch {
            try? await Task.sleep(for: .milliseconds(350))
            do {
                return .verified(try await fetchState(token: token))
            } catch {
                return .verificationUnavailable(acknowledged: acknowledged)
            }
        }
    }

    private static func send(_ request: URLRequest) async throws -> WatchLightState {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw WatchLightAPIError.server("The light service is unavailable.")
        }
        guard let http = response as? HTTPURLResponse else { throw WatchLightAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 {
                WatchLightStore.clearSession()
                throw WatchLightAPIError.notAuthenticated
            }
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw WatchLightAPIError.server(message ?? "Light request failed (\(http.statusCode)).")
        }
        guard let state = try? JSONDecoder().decode(WatchLightState.self, from: data) else {
            throw WatchLightAPIError.invalidResponse
        }
        return state
    }
}

/// Serializes Watch-originated commands within the app/extension process. The
/// server's idempotency and revision handling remain the cross-process source
/// of truth, but this prevents rapid local taps and App Intent actions from
/// deriving competing targets from the same stale cache.
actor WatchLightCommandCoordinator {
    static let shared = WatchLightCommandCoordinator()

    func set(_ physicalOn: Bool, token: String) async throws -> WatchLightAPI.SetAndVerifyResult {
        try await WatchLightAPI.setAndVerifyPhysicalLight(on: physicalOn, token: token)
    }

    func toggle(token: String) async throws -> WatchLightAPI.SetAndVerifyResult {
        let current = try await WatchLightAPI.fetchState(token: token)
        guard current.hasConfirmedDesiredState else {
            throw WatchLightAPIError.server("Refresh a confirmed light state before toggling.")
        }
        return try await WatchLightAPI.setAndVerifyPhysicalLight(on: !current.physicalOn, token: token)
    }
}

// MARK: - Public weekly Strava score

/// A compact, cached projection of the public scoreboard. The server remains
/// the source of truth; the cache keeps Watch surfaces useful between WidgetKit
/// refresh opportunities and during a temporary network failure.
struct WatchWeeklyScore: Codable, Equatable {
    let yannickScore: Int?
    let emmaScore: Int?
    let dateLabel: String
    let weekStart: String?
    let winner: String?
    let lastUpdatedAt: String?
    let isStale: Bool
    let isCached: Bool

    static let unavailable = WatchWeeklyScore(
        yannickScore: nil, emmaScore: nil, dateLabel: "Score unavailable", weekStart: nil,
        winner: nil, lastUpdatedAt: nil, isStale: true, isCached: false
    )

    var isAvailable: Bool { yannickScore != nil && emmaScore != nil }

    var leaderDescription: String {
        guard let yannickScore, let emmaScore else { return "Score unavailable" }
        if let winner {
            return winner.caseInsensitiveCompare("yannick") == .orderedSame ? "Yannick leads" : "Emma leads"
        }
        if yannickScore == emmaScore { return "Tied" }
        return yannickScore > emmaScore ? "Yannick leads" : "Emma leads"
    }

    func withStale(_ stale: Bool) -> WatchWeeklyScore {
        WatchWeeklyScore(yannickScore: yannickScore, emmaScore: emmaScore, dateLabel: dateLabel,
                         weekStart: weekStart, winner: winner, lastUpdatedAt: lastUpdatedAt,
                         isStale: stale, isCached: true)
    }

    private static let cacheKey = "weeklyScore.v1"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: WatchLightStore.appGroupIdentifier) }

    static var cached: WatchWeeklyScore? {
        guard let data = defaults?.data(forKey: cacheKey), let value = try? JSONDecoder().decode(WatchWeeklyScore.self, from: data) else { return nil }
        return value.withStale(true)
    }

    static func save(_ value: WatchWeeklyScore) {
        let cached = WatchWeeklyScore(yannickScore: value.yannickScore, emmaScore: value.emmaScore,
                                      dateLabel: value.dateLabel, weekStart: value.weekStart, winner: value.winner,
                                      lastUpdatedAt: value.lastUpdatedAt, isStale: value.isStale, isCached: true)
        defaults?.set(try? JSONEncoder().encode(cached), forKey: cacheKey)
    }
}

enum WatchScoreAPI {
    private static let endpoint = URL(string: "https://yannickmorgans.ca/api/strava-challenge/public")!

    static func fetchCurrentWeeklyScore() async throws -> WatchWeeklyScore {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw WatchLightAPIError.server("The score service is unavailable.")
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw WatchLightAPIError.server("The score service is unavailable.")
        }
        let dashboard: PublicScoreboard
        do { dashboard = try JSONDecoder().decode(PublicScoreboard.self, from: data) }
        catch { throw WatchLightAPIError.invalidResponse }
        guard dashboard.configured != false else {
            throw WatchLightAPIError.server("The weekly score is not configured yet.")
        }
        return WatchWeeklyScore(
            yannickScore: dashboard.currentWeek.score.yannick,
            emmaScore: dashboard.currentWeek.score.emma,
            dateLabel: dashboard.currentWeek.dateLabel ?? "Current week",
            weekStart: dashboard.currentWeek.weekStart,
            winner: dashboard.currentWeek.winner,
            lastUpdatedAt: dashboard.lastUpdatedAt,
            isStale: dashboard.stale ?? false,
            isCached: false
        )
    }

    private struct PublicScoreboard: Decodable {
        let configured: Bool?
        let currentWeek: CurrentWeek
        let lastUpdatedAt: String?
        let stale: Bool?
    }
    private struct CurrentWeek: Decodable {
        let score: TwoPersonScore
        let dateLabel: String?
        let weekStart: String?
        let winner: String?
    }
    private struct TwoPersonScore: Decodable {
        let yannick: Int
        let emma: Int
    }
}
