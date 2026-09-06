import Foundation

/// Compact, presentation-ready representation of the public current-week
/// challenge response. `isCached` means the network could not be refreshed;
/// it is deliberately separate from the server's own Strava `stale` flag.
struct WeeklyScore: Codable, Equatable, Sendable {
    let yannickScore: Int
    let emmaScore: Int
    let dateLabel: String
    let weekStart: String?
    let winner: String?
    let lastUpdatedAt: Date?
    let isStale: Bool
    let isCached: Bool

    var leaderDescription: String {
        if yannickScore == emmaScore { return "Tied" }
        return yannickScore > emmaScore ? "Yannick leads" : "Emma leads"
    }

    func markedCached() -> WeeklyScore {
        WeeklyScore(yannickScore: yannickScore, emmaScore: emmaScore, dateLabel: dateLabel,
                    weekStart: weekStart, winner: winner, lastUpdatedAt: lastUpdatedAt,
                    isStale: isStale, isCached: true)
    }
}

enum ScoreServiceError: LocalizedError {
    case invalidResponse
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "The weekly score response was invalid."
        case .unavailable(let detail): return detail
        }
    }
}

actor ScoreService {
    static let shared = ScoreService()
    private let endpoint = URL(string: "https://yannickmorgans.ca/api/strava-challenge/public")!

    func getCurrentWeeklyScore() async throws -> WeeklyScore {
        do {
            var request = URLRequest(url: endpoint)
            request.httpMethod = "GET"
            request.timeoutInterval = 12
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw ScoreServiceError.unavailable("The weekly score is temporarily unavailable.")
            }
            let score = try ScoreService.decodeDashboard(data)
            SharedSettings.saveLastWeeklyScore(score)
            return score
        } catch let error as ScoreServiceError {
            if let cached = SharedSettings.lastWeeklyScore { return cached.markedCached() }
            throw error
        } catch {
            if let cached = SharedSettings.lastWeeklyScore { return cached.markedCached() }
            throw ScoreServiceError.unavailable("The weekly score is temporarily unavailable.")
        }
    }

    func getCurrentWeekInformation() async throws -> WeeklyScore {
        try await getCurrentWeeklyScore()
    }

    func cachedWeeklyScore() -> WeeklyScore? { SharedSettings.lastWeeklyScore?.markedCached() }

    static func decodeDashboard(_ data: Data) throws -> WeeklyScore {
        let dashboard = try JSONDecoder.scoreDecoder.decode(PublicChallengeDashboard.self, from: data)
        guard dashboard.configured != false, let currentWeek = dashboard.currentWeek else {
            throw ScoreServiceError.invalidResponse
        }
        return WeeklyScore(
            yannickScore: currentWeek.score.yannick,
            emmaScore: currentWeek.score.emma,
            dateLabel: currentWeek.dateLabel ?? currentWeek.weekStart ?? "Current week",
            weekStart: currentWeek.weekStart,
            winner: currentWeek.winner,
            lastUpdatedAt: dashboard.lastUpdatedAt,
            isStale: dashboard.stale ?? false,
            isCached: false
        )
    }
}

private struct PublicChallengeDashboard: Decodable {
    let configured: Bool?
    let currentWeek: PublicChallengeWeek?
    let lastUpdatedAt: Date?
    let stale: Bool?
}

private struct PublicChallengeWeek: Decodable {
    let weekStart: String?
    let dateLabel: String?
    let winner: String?
    let score: ScorePair
}

private struct ScorePair: Decodable { let yannick: Int; let emma: Int }

private extension JSONDecoder {
    static var scoreDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { source in
            let container = try source.singleValueContainer()
            let value = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) { return date }
            let standard = ISO8601DateFormatter()
            if let date = standard.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO-8601 date")
        }
        return decoder
    }
}
