import Foundation

struct DeepLinkHandler {
  static func process(_ url: URL) -> DeepLinkData? {
    guard url.scheme == "scora" else { return nil }
    guard url.host == "auth" else { return nil }
    
    let components = URLComponents(url: url, resolvingAgainstBaseURL: true)
    guard let queryItems = components?.queryItems else { return nil }
    
    var athleteId: String?
    var athleteName: String?
    
    for item in queryItems {
      if item.name == "athlete_id" {
        athleteId = item.value
      } else if item.name == "name" {
        athleteName = item.value
      }
    }
    
    if let id = athleteId, let name = athleteName {
      return DeepLinkData(athleteId: id, athleteName: name)
    }
    
    return nil
  }
}
