import Foundation

class TokenManager: ObservableObject {
  @Published var isAuthenticated = false
  @Published var athleteName = ""
  @Published var needsOnboarding = false
  // Right after sign-in, while the API is asked whether this athlete already
  // finished onboarding. The app shows a plain wait screen instead of
  // flashing the first onboarding step.
  @Published var checkingOnboarding = false
  
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
    #if DEBUG
    if DemoMode.showsSignIn { isAuthenticated = false }
    if DemoMode.onboardingStep != nil { needsOnboarding = true }
    if DemoMode.isOn { return } // the demo never calls the API
    #endif
    // A choice skipped during onboarding is sent again on launch.
    if isAuthenticated {
      let id = athleteId
      Task { await self.refreshOnboarding(athleteId: id) }
    }
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
      if firstSignIn {
        self.needsOnboarding = true
        self.checkingOnboarding = true
      }
    }
    // A device token may already be waiting from launch — register it now that
    // we have an athlete id.
    PushManager.shared.onAuthenticated()
    Task { await self.refreshOnboarding(athleteId: athleteId) }
  }

  // Sends any onboarding choice still waiting on the phone, then, if this
  // phone thinks onboarding is still ahead, asks the API. An athlete the
  // server already has on record (signed out and back in, a new phone) skips
  // it. This only ever clears the flag, so it cannot send someone who
  // finished meanwhile back to the start. With no answer, onboarding runs.
  func refreshOnboarding(athleteId: String) async {
    await OnboardingSync.flush(athleteId: athleteId)
    var done = false
    if OnboardingState.needsOnboarding {
      if OnboardingSync.hasPending(for: athleteId) {
        done = true
      } else if await OnboardingSync.remoteOnboarded(athleteId: athleteId) == true {
        done = true
      }
    }
    // The answer is about `athleteId`. If they signed out (or someone else
    // signed in) while it was on its way, it changes nothing for who is here now.
    guard Self.answerApplies(askedFor: athleteId, signedIn: self.athleteId) else { return }
    if done { OnboardingState.needsOnboarding = false }
    let finished = done
    await MainActor.run {
      guard Self.answerApplies(askedFor: athleteId, signedIn: self.athleteId) else { return }
      if finished { self.needsOnboarding = false }
      self.checkingOnboarding = false
    }
  }

  static func answerApplies(askedFor: String, signedIn: String) -> Bool {
    !askedFor.isEmpty && askedFor == signedIn
  }
  
  func logout() {
    PushManager.shared.unregister(athleteId: athleteId)
    TimeZoneSync.forget()
    ReadCache.clear() // the last read is this athlete's health data
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
      self.checkingOnboarding = false
    }
  }

  func finishOnboarding() {
    #if DEBUG
    if DemoMode.isOn { needsOnboarding = false; return } // nothing stored
    #endif
    OnboardingState.needsOnboarding = false
    DispatchQueue.main.async { self.needsOnboarding = false }
  }
}
