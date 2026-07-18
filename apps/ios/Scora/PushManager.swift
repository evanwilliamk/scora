import SwiftUI
import UserNotifications

// Handles APNs: request permission, capture the device token, and register it
// with the backend so SCORA can push the daily read. Registration needs both a
// device token and an athlete id, which can arrive in either order (token on
// launch, athlete id after sign-in) — sync() fires once both are present.
final class PushManager {
  static let shared = PushManager()

  private let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"
  private let tokenKey = "scora.deviceToken"
  private let athleteIdKey = "scora.athleteId" // same key TokenManager writes

  private var deviceToken: String? {
    get { UserDefaults.standard.string(forKey: tokenKey) }
    set { UserDefaults.standard.set(newValue, forKey: tokenKey) }
  }

  func requestAuthorization() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      guard granted else { return }
      DispatchQueue.main.async {
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }

  // Called by the app delegate when APNs returns a token.
  func setDeviceToken(_ token: String) {
    deviceToken = token
    sync()
  }

  // Called after sign-in so a token captured before auth still gets registered.
  func onAuthenticated() {
    sync()
  }

  private func sync() {
    guard
      let token = deviceToken,
      let athleteId = UserDefaults.standard.string(forKey: athleteIdKey), !athleteId.isEmpty,
      let url = URL(string: "\(apiBase)/api/register-device")
    else { return }

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(
      withJSONObject: ["athleteId": athleteId, "deviceToken": token]
    )
    URLSession.shared.dataTask(with: req).resume()
  }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    PushManager.shared.requestAuthorization()
    return true
  }

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    PushManager.shared.setDeviceToken(token)
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    print("APNs registration failed: \(error.localizedDescription)")
  }
}
