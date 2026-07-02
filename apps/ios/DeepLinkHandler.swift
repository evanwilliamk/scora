import Foundation

struct DeepLinkHandler {
  /// Processes `scora://auth/success?athlete_id=...&name=...&token=...` links
  /// from the Strava OAuth callback. Persists the token to UserDefaults via
  /// `TokenStore` as a side effect, so ChatViewModel can find it immediately
  /// without re-plumbing state through the deep link data.
  static func process(_ url: URL) -> DeepLinkData? {
    guard url.scheme == "scora" else { return nil }
    guard url.host == "auth" else { return nil }

    let components = URLComponents(url: url, resolvingAgainstBaseURL: true)
    guard let queryItems = components?.queryItems else { return nil }

    var athleteId: String?
    var athleteName: String?
    var accessToken: String?
    var refreshToken: String?
    var expiresAt: Int?

    for item in queryItems {
      switch item.name {
      case "athlete_id":
        athleteId = item.value
      case "name":
        athleteName = item.value
      case "token", "access_token":
        accessToken = item.value
      case "refresh_token":
        refreshToken = item.value
      case "expires_at":
        expiresAt = item.value.flatMap { Int($0) }
      default:
        break
      }
    }

    guard let id = athleteId, let name = athleteName else { return nil }

    if let token = accessToken {
      TokenStore.save(
        athleteId: id,
        athleteName: name,
        accessToken: token,
        refreshToken: refreshToken,
        expiresAt: expiresAt
      )
    }

    return DeepLinkData(athleteId: id, athleteName: name)
  }
}
