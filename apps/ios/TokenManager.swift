import Foundation

class TokenManager: ObservableObject {
  @Published var stravaToken: String?
  @Published var athleteId: String?
  @Published var athleteName: String?
  
  private let tokenKey = "strava_token"
  private let athleteIdKey = "athlete_id"
  private let athleteNameKey = "athlete_name"
  
  init() {
    self.stravaToken = UserDefaults.standard.string(forKey: tokenKey)
    self.athleteId = UserDefaults.standard.string(forKey: athleteIdKey)
    self.athleteName = UserDefaults.standard.string(forKey: athleteNameKey)
  }
  
  func saveToken(_ token: String, athleteId: String, athleteName: String) {
    DispatchQueue.main.async {
      self.stravaToken = token
      self.athleteId = athleteId
      self.athleteName = athleteName
    }
    
    UserDefaults.standard.set(token, forKey: tokenKey)
    UserDefaults.standard.set(athleteId, forKey: athleteIdKey)
    UserDefaults.standard.set(athleteName, forKey: athleteNameKey)
  }
  
  func clear() {
    DispatchQueue.main.async {
      self.stravaToken = nil
      self.athleteId = nil
      self.athleteName = nil
    }
    
    UserDefaults.standard.removeObject(forKey: tokenKey)
    UserDefaults.standard.removeObject(forKey: athleteIdKey)
    UserDefaults.standard.removeObject(forKey: athleteNameKey)
  }
  
  var isAuthenticated: Bool {
    stravaToken != nil && athleteId != nil
  }
}
