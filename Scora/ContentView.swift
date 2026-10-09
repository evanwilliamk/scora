import SwiftUI

struct ContentView: View {
    @AppStorage("scora_isOnboarded") private var isOnboarded = false

    var body: some View {
        if isOnboarded {
            TabView {
                HomeView()
                    .tabItem { Label("Today",    systemImage: "flame.fill") }

                TrendsView()
                    .tabItem { Label("Trends",   systemImage: "chart.bar.fill") }

                CheckInView()
                    .tabItem { Label("Check-In", systemImage: "calendar.badge.checkmark") }
            }
            .tint(.orange)
        } else {
            OnboardingView()
        }
    }
}
