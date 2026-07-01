import SwiftUI

@main
struct SCORAApp: App {
  @State private var deepLinkData: DeepLinkData?
  
  var body: some Scene {
    WindowGroup {
      ContentView(deepLinkData: $deepLinkData)
        .onOpenURL { url in
          deepLinkData = DeepLinkHandler.process(url)
        }
    }
  }
}

struct DeepLinkData {
  let athleteId: String
  let athleteName: String
}
