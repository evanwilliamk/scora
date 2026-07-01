import SwiftUI

struct StravaAuthButton: View {
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
  }
  
  func openStravaAuth() {
    guard let authURL = URL(string: "\(apiBaseURL)/api/auth/strava") else {
      print("ERROR: Could not create URL")
      return
    }
    print("Opening Strava auth: \(authURL)")
    UIApplication.shared.open(authURL)
  }
}

#Preview {
  ZStack {
    Color.black.ignoresSafeArea()
    StravaAuthButton()
      .padding(20)
  }
}
