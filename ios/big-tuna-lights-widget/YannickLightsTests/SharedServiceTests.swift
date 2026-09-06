import XCTest
@testable import YannickLights

final class SharedServiceTests: XCTestCase {
    func testLightStateDecodesAuthoritativePayload() throws {
        let data = Data(#"{"physicalOn":true,"reportedPhysicalOn":false,"recentlyPolled":true,"updatedAt":"2026-09-05T10:00:00.000Z","revision":"42"}"#.utf8)
        let state = try JSONDecoder().decode(LightState.self, from: data)
        XCTAssertTrue(state.physicalOn)
        XCTAssertEqual(state.reportedPhysicalOn, false)
        XCTAssertTrue(state.recentlyPolled)
        XCTAssertEqual(state.revision, "42")
    }

    func testScoreboardDecodesPublicCurrentWeek() throws {
        let data = Data(#"{"configured":true,"currentWeek":{"weekStart":"2026-09-01","dateLabel":"Sep 1–7","winner":"yannick","score":{"yannick":4,"emma":3}},"lastUpdatedAt":"2026-09-05T10:00:00Z","stale":false}"#.utf8)
        let score = try ScoreService.decodeDashboard(data)
        XCTAssertEqual(score.yannickScore, 4)
        XCTAssertEqual(score.emmaScore, 3)
        XCTAssertEqual(score.dateLabel, "Sep 1–7")
        XCTAssertFalse(score.isCached)
        XCTAssertEqual(score.leaderDescription, "Yannick leads")
    }

    func testMalformedScoreboardIsRejected() {
        XCTAssertThrowsError(try ScoreService.decodeDashboard(Data("{}".utf8)))
    }

    func testExplicitCommandPayloadHasStableTargetAndID() throws {
        let commandID = UUID(uuidString: "AE419E20-633D-4F56-811C-2EFD55E1945A")!
        let data = try BigTunaLightsAPI.makeCommandBody(physicalOn: true, commandId: commandID)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(object?["physicalOn"] as? Bool, true)
        XCTAssertEqual(object?["commandId"] as? String, commandID.uuidString)
    }

    func testHTTPAuthenticationErrorIsTyped() {
        XCTAssertThrowsError(try BigTunaLightsAPI.validateHTTPResponse(statusCode: 401, data: Data())) { error in
            guard case BigTunaLightsAPIError.notAuthenticated = error else {
                return XCTFail("Expected the authentication error, got \(error)")
            }
        }
    }

    func testHTTPServerErrorPreservesSafeMessage() {
        let data = Data(#"{"error":"Service temporarily unavailable"}"#.utf8)
        XCTAssertThrowsError(try BigTunaLightsAPI.validateHTTPResponse(statusCode: 503, data: data)) { error in
            guard case BigTunaLightsAPIError.server(let message) = error else {
                return XCTFail("Expected a server error, got \(error)")
            }
            XCTAssertEqual(message, "Service temporarily unavailable")
        }
    }

    func testCachedScoreIsMarkedRatherThanClaimedFresh() {
        let fresh = WeeklyScore(yannickScore: 2, emmaScore: 2, dateLabel: "Current week", weekStart: nil, winner: nil, lastUpdatedAt: nil, isStale: false, isCached: false)
        XCTAssertTrue(fresh.markedCached().isCached)
        XCTAssertEqual(fresh.markedCached().leaderDescription, "Tied")
    }
}
