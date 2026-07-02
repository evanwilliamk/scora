import SwiftUI

struct ContentView: View {
  @ObservedObject var tokenManager: TokenManager
  
  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      
      VStack(spacing: 40) {
        Spacer()
        
        // Logo
        Text("S")
          .font(.system(size: 100, weight: .bold))
          .foregroundColor(.white)
        
        // Title
        Text("SCORA")
          .font(.system(size: 48, weight: .bold))
          .foregroundColor(.white)
        
        // Tagline
        Text("AI fitness coach that reads your body and adapts your training.")
          .font(.system(size: 18))
          .foregroundColor(Color(white: 0.6))
          .multilineTextAlignment(.center)
          .padding(.horizontal, 20)
        
        Spacer()
        
        // Features
        VStack(alignment: .leading, spacing: 16) {
          FeatureRow(icon: "heart.fill", text: "Daily posture reads")
          FeatureRow(icon: "bolt.fill", text: "Real-time adaptation")
          FeatureRow(icon: "link", text: "Strava + Oura integration")
          FeatureRow(icon: "person.2.fill", text: "Human coach marketplace")
        }
        .padding(.horizontal, 20)
        
        Spacer()
        
        // Auth Button
        StravaAuthButton()
          .padding(.horizontal, 20)
        
        Spacer()
          .frame(height: 20)
      }
    }
  }
}

struct FeatureRow: View {
  let icon: String
  let text: String
  
  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 14))
        .foregroundColor(.white)
        .frame(width: 16)
      
      Text(text)
        .font(.system(size: 16))
        .foregroundColor(Color(white: 0.8))
    }
  }
}

#Preview {
  ContentView(tokenManager: TokenManager())
}
