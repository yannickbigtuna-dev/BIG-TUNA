import Foundation

/// This is the single compatibility boundary for native light access. Views,
/// widgets and controls always work in physical (not inverted relay) state.
struct LightState: Decodable, Equatable {
    let physicalOn: Bool
    let reportedPhysicalOn: Bool?
    let recentlyPolled: Bool
    let updatedAt: String?
    let revision: String
}

struct LoginSession: Decodable {
    let token: String
    let username: String
}

enum BigTunaLightsAPIError: LocalizedError {
    case invalidURL
    case notAuthenticated
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API URL."
        case .notAuthenticated:
            return "Sign in as yannick to control the light."
        case .invalidResponse:
            return "The server returned an invalid response."
        case .server(let message):
            return message
        }
    }
}

enum BigTunaLightsAPI {
    private enum Endpoint {
        static let baseURL = URL(string: "https://yannickmorgans.ca")!
        static let nativeState = "/api/lights/native/v1"
        static let nativeSession = "/api/lights/native/v1/session"
        static let login = "/api/auth/login"
        static let logout = "/api/auth/logout"
    }

    static func fetchState(token: String) async throws -> LightState {
        var request = makeRequest(path: Endpoint.nativeState, method: "GET")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return try await send(request, as: LightState.self)
    }

    static func login(username: String, password: String) async throws -> LoginSession {
        var request = makeRequest(path: Endpoint.login, method: "POST")
        request.httpBody = try JSONEncoder().encode([
            "username": username,
            "password": password
        ])
        let websiteSession = try await send(request, as: LoginSession.self)
        guard websiteSession.username.caseInsensitiveCompare("yannick") == .orderedSame else {
            await logoutWebsite(token: websiteSession.token)
            throw BigTunaLightsAPIError.notAuthenticated
        }
        var exchange = makeRequest(path: Endpoint.nativeSession, method: "POST")
        exchange.setValue("Bearer \(websiteSession.token)", forHTTPHeaderField: "Authorization")
        let nativeSession: LoginSession
        do {
            nativeSession = try await send(exchange, as: LoginSession.self)
        } catch {
            await logoutWebsite(token: websiteSession.token)
            throw error
        }
        await logoutWebsite(token: websiteSession.token)
        return nativeSession
    }

    static func logout(token: String) async {
        do {
            var request = makeRequest(path: Endpoint.nativeSession, method: "DELETE")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try await send(request, as: EmptyResponse.self)
        } catch {
            return
        }
    }

    static func validateOwner(token: String) async throws -> Bool {
        _ = try await fetchState(token: token)
        return true
    }

    /// Uses an explicit physical target and one unique command ID per action;
    /// callers persist only the returned authoritative state.
    static func setPhysicalLight(on physicalOn: Bool, token: String, commandId: UUID = UUID()) async throws -> LightState {
        var request = makeRequest(path: Endpoint.nativeState, method: "PUT")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(commandId.uuidString, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(NativeLightCommand(
            physicalOn: physicalOn,
            commandId: commandId.uuidString
        ))
        return try await send(request, as: LightState.self)
    }

    private static func makeRequest(path: String, method: String) -> URLRequest {
        let url = URL(string: path, relativeTo: Endpoint.baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method == "POST" || method == "PUT" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private static func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw BigTunaLightsAPIError.invalidResponse
            }
            guard (200..<300).contains(http.statusCode) else {
                let message = parseErrorMessage(from: data) ?? "Request failed with status \(http.statusCode)."
                if http.statusCode == 401 {
                    SharedSettings.clearSession()
                    IPhoneWatchConnectivity.shared.publishCurrentContext()
                    throw BigTunaLightsAPIError.notAuthenticated
                }
                throw BigTunaLightsAPIError.server(message)
            }
            if T.self == EmptyResponse.self { return EmptyResponse() as! T }
            return try JSONDecoder().decode(T.self, from: data)
        } catch let error as BigTunaLightsAPIError {
            throw error
        } catch {
            throw BigTunaLightsAPIError.server("The light service is unavailable.")
        }
    }

    private static func parseErrorMessage(from data: Data) -> String? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let message = object["error"] as? String,
            !message.isEmpty
        else {
            return nil
        }
        return message
    }

    private static func logoutWebsite(token: String) async {
        var request = makeRequest(path: Endpoint.logout, method: "POST")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        _ = try? await send(request, as: EmptyResponse.self)
    }
}

private struct NativeLightCommand: Encodable {
    let physicalOn: Bool
    let commandId: String
}

private struct EmptyResponse: Decodable {}
