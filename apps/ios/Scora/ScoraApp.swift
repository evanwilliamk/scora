import SwiftUI

@main
struct ScoraApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var tokenManager = TokenManager()

  #if DEBUG
  init() {
    if DemoMode.waitingBanner { OuraLinkResult.pending = OuraLinkResult(connected: true, message: StravaReconnect.connectedLine) }
  }
  #endif

  var body: some Scene {
    WindowGroup {
      if tokenManager.isAuthenticated && tokenManager.checkingOnboarding {
        // A moment after sign-in, while the API says whether onboarding is done.
        ProgressView()
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(Color.black)
          .preferredColorScheme(.dark)
          .onOpenURL { url in
            handleDeepLink(url)
          }
      } else if tokenManager.isAuthenticated && tokenManager.needsOnboarding {
        OnboardingView(tokenManager: tokenManager, onFinish: {})
          .onOpenURL { url in
            handleDeepLink(url)
          }
      } else if tokenManager.isAuthenticated {
        DashboardView(tokenManager: tokenManager)
          .onOpenURL { url in
            handleDeepLink(url)
          }
          #if DEBUG
          .task {
            guard let link = DemoMode.link else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            handleDeepLink(link)
          }
          #endif
      } else {
        ContentView(tokenManager: tokenManager)
          .onOpenURL { url in
            handleDeepLink(url)
          }
      }
    }
  }
  
  private func handleDeepLink(_ url: URL) {
    guard url.scheme == "scora" else { return }

    if url.host == "auth" && url.path == "/success" {
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)

      if let athleteId = components?.queryItems?.first(where: { $0.name == "athlete_id" })?.value,
         let name = components?.queryItems?.first(where: { $0.name == "name" })?.value,
         let token = components?.queryItems?.first(where: { $0.name == "token" })?.value {
        let outcome = StravaReconnect.resolve(incoming: athleteId)
        if outcome == .otherAccount {
          OuraLinkResult.deliver(OuraLinkResult(connected: false, message: StravaReconnect.otherAccountLine), dashboardIsRoot: dashboardIsRoot)
          return
        }
        tokenManager.saveToken(token, athleteId: athleteId, athleteName: name)
        if outcome == .reconnected {
          NotificationCenter.default.post(name: StravaReconnect.reconnected, object: nil)
          OuraLinkResult.deliver(OuraLinkResult(connected: true, message: StravaReconnect.connectedLine), dashboardIsRoot: dashboardIsRoot)
        }
      }
    }

    if url.host == "auth" && url.path == "/failed", let line = StravaReconnect.failure() {
      OuraLinkResult.deliver(line, dashboardIsRoot: dashboardIsRoot)
    }

    // Oura linking finished on the web. Success reloads the dashboard so the
    // Sleep + Recovery cards pick up the new data; either way the dashboard
    // shows a short banner saying what happened.
    if let result = OuraLinkResult(url: url) {
      if result.connected {
        NotificationCenter.default.post(name: Notification.Name("ouraConnected"), object: nil)
      }
      OuraLinkResult.deliver(result, dashboardIsRoot: dashboardIsRoot)
    }
  }

  private var dashboardIsRoot: Bool {
    tokenManager.isAuthenticated && !tokenManager.needsOnboarding && !tokenManager.checkingOnboarding
  }
}
