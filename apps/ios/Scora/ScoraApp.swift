import SwiftUI

extension Notification.Name {
  static let ouraConnected = Notification.Name("ouraConnected")
}

@main
struct ScoraApp: App {
  @StateObject private var tokenManager = TokenManager()
  
  var body: some Scene {
    WindowGroup {
      if tokenManager.isAuthenticated {
        DashboardView(tokenManager: tokenManager)
          .onOpenURL { url in
            handleDeepLink(url)
          }
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
        tokenManager.saveToken(token, athleteId: athleteId, athleteName: name)
      }
    }

    // Oura finished linking on the web — tell the dashboard to reload so the
    // Sleep + Recovery cards pick up the new data.
    if url.host == "oura" && url.path == "/success" {
      NotificationCenter.default.post(name: .ouraConnected, object: nil)
    }
  }
}
