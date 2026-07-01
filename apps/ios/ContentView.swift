import SwiftUI
import Combine

struct ContentView: View {
  @Binding var deepLinkData: DeepLinkData?
  @State private var isAuthenticated = false
  @State private var athleteName: String?
  
  var body: some View {
    ZStack {
      // Black background
      Color.black.ignoresSafeArea()
      
      VStack(spacing: 40) {
        // Logo
        VStack(spacing: 20) {
          Text("S")
            .font(.system(size: 100, weight: .heavy))
            .foregroundColor(.white)
          
          Text("SCORA")
            .font(.system(size: 36, weight: .bold))
            .foregroundColor(.white)
          
          Text("AI fitness coach that reads your body and adapts your training.")
            .font(.system(size: 16))
            .foregroundColor(.gray)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)
        }
        
        Spacer()
        
        // Features list
        VStack(alignment: .leading, spacing: 12) {
          FeatureRow(text: "Daily posture reads")
          FeatureRow(text: "Real-time adaptation")
          FeatureRow(text: "Strava + Oura integration")
          FeatureRow(text: "Human coach marketplace")
        }
        .padding(.horizontal, 20)
        
        Spacer()
        
        // Auth button or success state
        if isAuthenticated, let name = athleteName {
          VStack(spacing: 16) {
            Text("✓")
              .font(.system(size: 48))
              .foregroundColor(.white)
            
            Text("Strava Linked")
              .font(.system(size: 24, weight: .bold))
              .foregroundColor(.white)
            
            Text("Welcome, \(name)!")
              .font(.system(size: 16))
              .foregroundColor(.gray)
          }
          .padding(.bottom, 40)
        } else {
          StravaAuthButton()
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
      }
      .padding(.top, 40)
    }
    .onReceive(Just(deepLinkData)) { newData in
      if let data = newData {
        athleteName = data.athleteName
        isAuthenticated = true
      }
    }
  }
}

import Combine

struct FeatureRow: View {
  let text: String
  
  var body: some View {
    HStack(spacing: 12) {
      Text("•")
        .foregroundColor(.gray)
        .font(.system(size: 16))
      
      Text(text)
        .foregroundColor(.white)
        .font(.system(size: 16))
      
      Spacer()
    }
  }
}

#Preview {
  ContentView(deepLinkData: .constant(nil))
}
