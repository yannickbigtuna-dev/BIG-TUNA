import Foundation

struct LightState: Decodable, Equatable {
    let on: Bool
    let updatedAt: String?

    var physicalOn: Bool {
        !on
    }

    static func apiValue(forPhysicalOn physicalOn: Bool) -> Bool {
        !physicalOn
    }
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
    private static let baseURL = URL(string: "https://yannickmorgans.ca")!

    static func fetchState() async throws -> LightState {
        let request = try makeRequest(path: "/api/lights", method: "GET")
        return try await send(request, as: LightState.self)
    }

    static func login(username: String, password: String) async throws -> LoginSession {
        var request = try makeRequest(path: "/api/auth/login", method: "POST")
        request.httpBody = try JSONEncoder().encode([
            "username": username,
            "password": password
        ])
        return try await send(request, as: LoginSession.self)
    }

    static func logout(token: String) async {
        do {
            var request = try makeRequest(path: "/api/auth/logout", method: "POST")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try await send(request, as: EmptyResponse.self)
        } catch {
            return
        }
    }

    static func setPhysicalLight(on physicalOn: Bool, token: String) async throws -> LightState {
        var request = try makeRequest(path: "/api/lights", method: "POST")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode([
            "on": LightState.apiValue(forPhysicalOn: physicalOn)
        ])
        return try await send(request, as: LightState.self)
    }

    static func togglePhysicalLight(token: String) async throws -> LightState {
        let current = try await fetchState()
        return try await setPhysicalLight(on: !current.physicalOn, token: token)
    }

    private static func makeRequest(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw BigTunaLightsAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method == "POST" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private static func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BigTunaLightsAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = parseErrorMessage(from: data) ?? "Request failed with status \(http.statusCode)."
            if http.statusCode == 401 {
                throw BigTunaLightsAPIError.notAuthenticated
            }
            throw BigTunaLightsAPIError.server(message)
        }
        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw BigTunaLightsAPIError.invalidResponse
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
}

private struct EmptyResponse: Decodable {}
