import SwiftUI

struct ContentView: View {
  @ObservedObject var tokenManager: TokenManager
  
  var body: some View {
    VStack(spacing: 20) {
      Spacer()
      
      Text("SCORA")
        .font(.system(size: 48, weight: .bold, design: .default))
        .foregroundColor(.white)
      
      Text("Endurance athlete insights")
        .font(.subheadline)
        .foregroundColor(.white)
        .opacity(0.7)
      
      Spacer()
      
      Button(action: {
        if let url = URL(string: "https://zonal-prosperity-production-3965.up.railway.app/api/auth/strava") {
          UIApplication.shared.open(url)
        }
      }) {
        Text("Sign in with Strava")
          .font(.headline)
          .frame(maxWidth: .infinity)
          .padding()
          .background(Color.orange)
          .foregroundColor(.white)
          .cornerRadius(8)
      }
      .padding()
      
      Spacer()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
  }
}
