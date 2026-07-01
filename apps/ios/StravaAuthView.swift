import SwiftUI
import SafariServices

struct StravaAuthButton: View {
  @State private var showSafari = false
  @State private var stravaAuthURL: URL?
  
  let apiBaseURL = "https://zonal-prosperity-production-3965.up.railway.app"
  
  var body: some View {
    Button(action: openStravaAuth) {
      HStack(spacing: 12) {
        Image(systemName: "link")
        Text("Connect Strava")
      }
      .font(.system(size: 16, weight: .semibold))
      .foregroundColor(.black)
      .frame(maxWidth: .infinity)
      .frame(height: 48)
      .background(Color.white)
      .cornerRadius(8)
    }
    .sheet(isPresented: $showSafari) {
      if let url = stravaAuthURL {
        SafariView(url: url)
      }
    }
  }
  
  func openStravaAuth() {
    guard let authURL = URL(string: "\(apiBaseURL)/api/auth/strava") else {
      print("ERROR: Could not create URL")
      return
    }
    print("Opening Strava auth: \(authURL)")
    stravaAuthURL = authURL
    showSafari = true
  }
}

struct SafariView: UIViewControllerRepresentable {
  let url: URL
  @Environment(\.dismiss) var dismiss
  
  func makeUIViewController(context: UIViewControllerRepresentableContext<SafariView>) -> SFSafariViewController {
    let safari = SFSafariViewController(url: url)
    safari.preferredControlTintColor = .white
    return safari
  }
  
  func updateUIViewController(_ uiViewController: SFSafariViewController, context: UIViewControllerRepresentableContext<SafariView>) {}
}

#Preview {
  ZStack {
    Color.black.ignoresSafeArea()
    StravaAuthButton()
      .padding(20)
  }
}
