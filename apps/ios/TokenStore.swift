import Foundation

/// Persists Strava auth data (token + athlete info) in UserDefaults.
///
/// Phase 1 approach: the access token is stored on-device only (no server-side
/// storage yet — Supabase token storage was reverted in Phase 0 to avoid a
/// crashing dependency; see MEMORY.md). Every CDV request sends the token to
/// the backend, which uses it directly against the Strava API and never
/// persists it server-side.
///
/// Phase 2 TODO: move to Keychain (UserDefaults is not encrypted-at-rest for
/// sensitive tokens) and/or server-side storage with refresh-token rotation.
enum TokenStore {
  private enum Keys {
    static let athleteId = "scora.athleteId"
    static let athleteName = "scora.athleteName"
    static let accessToken = "scora.stravaAccessToken"
    static let refreshToken = "scora.stravaRefreshToken"
    static let expiresAt = "scora.stravaExpiresAt"
  }

  static func save(athleteId: String, athleteName: String, accessToken: String, refreshToken: String? = nil, expiresAt: Int? = nil) {
    let defaults = UserDefaults.standard
    defaults.set(athleteId, forKey: Keys.athleteId)
    defaults.set(athleteName, forKey: Keys.athleteName)
    defaults.set(accessToken, forKey: Keys.accessToken)
    if let refreshToken { defaults.set(refreshToken, forKey: Keys.refreshToken) }
    if let expiresAt { defaults.set(expiresAt, forKey: Keys.expiresAt) }
  }

  static var athleteId: String? {
    UserDefaults.standard.string(forKey: Keys.athleteId)
  }

  static var athleteName: String? {
    UserDefaults.standard.string(forKey: Keys.athleteName)
  }

  static var accessToken: String? {
    UserDefaults.standard.string(forKey: Keys.accessToken)
  }

  static var refreshToken: String? {
    UserDefaults.standard.string(forKey: Keys.refreshToken)
  }

  /// Unix timestamp (seconds) when the current access token expires, if known.
  static var expiresAt: Int? {
    let value = UserDefaults.standard.integer(forKey: Keys.expiresAt)
    return value == 0 ? nil : value
  }

  /// True once we have enough state persisted to call the CDV endpoint.
  static var isLinked: Bool {
    athleteId != nil && accessToken != nil
  }

  /// True if the stored access token is known to be expired (best-effort;
  /// Strava tokens are refreshed server-side in Phase 2). Returns false if we
  /// don't have an expiry timestamp.
  static var isTokenExpired: Bool {
    guard let expiresAt else { return false }
    return Date(timeIntervalSince1970: TimeInterval(expiresAt)) < Date()
  }

  static func clear() {
    let defaults = UserDefaults.standard
    defaults.removeObject(forKey: Keys.athleteId)
    defaults.removeObject(forKey: Keys.athleteName)
    defaults.removeObject(forKey: Keys.accessToken)
    defaults.removeObject(forKey: Keys.refreshToken)
    defaults.removeObject(forKey: Keys.expiresAt)
  }
}
