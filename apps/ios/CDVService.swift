import Foundation

/// Talks to the backend's `POST /api/cdv` (Chat-Driven Visualization) endpoint.
enum CDVServiceError: LocalizedError {
  case notLinked
  case tokenExpired
  case badResponse(Int, String)
  case decodeFailed

  var errorDescription: String? {
    switch self {
    case .notLinked:
      return "Connect Strava first to chat with SCORA."
    case .tokenExpired:
      return "Your Strava connection expired. Reconnect Strava and try again."
    case .badResponse(let code, let detail):
      return "SCORA couldn't read your data (HTTP \(code)). \(detail)"
    case .decodeFailed:
      return "Got an unexpected response from SCORA. Try again."
    }
  }
}

struct CDVResponse: Decodable {
  let voice: String
  let drivers: [ChatDriver]
}

enum CDVService {
  static let apiBaseURL = "https://zonal-prosperity-production-3965.up.railway.app"

  /// Sends a chat message to the CDV endpoint using the persisted Strava
  /// token + athlete id from `TokenStore`. Throws `CDVServiceError.notLinked`
  /// if the user hasn't connected Strava yet.
  static func send(message: String) async throws -> CDVResponse {
    guard let athleteId = TokenStore.athleteId, let stravaToken = TokenStore.accessToken else {
      throw CDVServiceError.notLinked
    }

    if TokenStore.isTokenExpired {
      throw CDVServiceError.tokenExpired
    }

    guard let url = URL(string: "\(apiBaseURL)/api/cdv") else {
      throw CDVServiceError.badResponse(0, "Invalid API URL")
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let body: [String: String] = [
      "message": message,
      "stravaToken": stravaToken,
      "athleteId": athleteId,
    ]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      throw CDVServiceError.decodeFailed
    }

    guard (200...299).contains(httpResponse.statusCode) else {
      let detail = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String ?? ""
      if httpResponse.statusCode == 401 {
        throw CDVServiceError.tokenExpired
      }
      throw CDVServiceError.badResponse(httpResponse.statusCode, detail)
    }

    do {
      return try JSONDecoder().decode(CDVResponse.self, from: data)
    } catch {
      throw CDVServiceError.decodeFailed
    }
  }
}
