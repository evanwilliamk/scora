import Foundation

class TokenManager: ObservableObject {
  @Published var isAuthenticated = false
  @Published var athleteName = ""
  @Published var needsOnboarding = false
  
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
    #if DEBUG
    if DemoMode.isOn { isAuthenticated = true }
    #endif
    athleteName = UserDefaults.standard.string(forKey: athleteNameKey) ?? ""
    needsOnboarding = OnboardingState.needsOnboarding
  }
  
  func saveToken(_ token: String, athleteId: String, athleteName: String) {
    UserDefaults.standard.set(token, forKey: tokenKey)
    UserDefaults.standard.set(athleteId, forKey: athleteIdKey)
    UserDefaults.standard.set(athleteName, forKey: athleteNameKey)
    // A fresh sign-in goes through onboarding once.
    let firstSignIn = !isAuthenticated
    if firstSignIn { OnboardingState.needsOnboarding = true }

    DispatchQueue.main.async {
      self.isAuthenticated = true
      self.athleteName = athleteName
      if firstSignIn { self.needsOnboarding = true }
    }
    // A device token may already be waiting from launch — register it now that
    // we have an athlete id.
    PushManager.shared.onAuthenticated()
  }
  
  func logout() {
    CalendarFeed.save(nil, for: athleteId) // the next athlete on this phone never refreshes this calendar
    UserDefaults.standard.removeObject(forKey: tokenKey)
    UserDefaults.standard.removeObject(forKey: athleteIdKey)
    UserDefaults.standard.removeObject(forKey: athleteNameKey)
    PushManager.shared.clearPendingOpens()
    OnboardingState.needsOnboarding = false

    DispatchQueue.main.async {
      self.isAuthenticated = false
      self.athleteName = ""
      self.needsOnboarding = false
    }
  }

  func finishOnboarding() {
    OnboardingState.needsOnboarding = false
    DispatchQueue.main.async { self.needsOnboarding = false }
  }
}
