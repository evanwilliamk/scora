import SwiftUI

@main
struct SCORAApp: App {
  @StateObject private var tokenManager = TokenManager()
  @State private var deepLinkPath: String?
  
  var body: some Scene {
    WindowGroup {
      if tokenManager.isAuthenticated {
        ChatView(tokenManager: tokenManager)
      } else {
        ContentView(tokenManager: tokenManager)
      }
    }
    .onOpenURL { url in
      handleDeepLink(url)
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
  }
}
