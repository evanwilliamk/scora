import Foundation

class TokenManager: ObservableObject {
  @Published var isAuthenticated = false
  @Published var athleteName = ""
  
  private let tokenKey = "scora.token"
  private let athleteIdKey = "scora.athleteId"
  private let athleteNameKey = "scora.athleteName"
  
  var stravaToken: String {
    UserDefaults.standard.string(forKey: tokenKey) ?? ""
  }
  
  var athleteId: String {
    UserDefaults.standard.string(forKey: athleteIdKey) ?? ""
  }
  
  init() {
    isAuthenticated = UserDefaults.standard.string(forKey: tokenKey) != nil
    athleteName = UserDefaults.standard.string(forKey: athleteNameKey) ?? ""
  }
  
  func saveToken(_ token: String, athleteId: String, athleteName: String) {
    UserDefaults.standard.set(token, forKey: tokenKey)
    UserDefaults.standard.set(athleteId, forKey: athleteIdKey)
    UserDefaults.standard.set(athleteName, forKey: athleteNameKey)
    
    DispatchQueue.main.async {
      self.isAuthenticated = true
      self.athleteName = athleteName
    }
  }
  
  func logout() {
    UserDefaults.standard.removeObject(forKey: tokenKey)
    UserDefaults.standard.removeObject(forKey: athleteIdKey)
    UserDefaults.standard.removeObject(forKey: athleteNameKey)
    
    DispatchQueue.main.async {
      self.isAuthenticated = false
      self.athleteName = ""
    }
  }
}
