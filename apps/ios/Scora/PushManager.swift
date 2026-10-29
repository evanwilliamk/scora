import SwiftUI
import UserNotifications

// Handles APNs: request permission, capture the device token, and register it
// with the backend so SCORA can push the daily read. Registration needs both a
// device token and an athlete id, which can arrive in either order (token on
// launch, athlete id after sign-in) — sync() fires once both are present.
// The `scora` payload of a scheduled push (kind, local date, send time in
// unix seconds), echoed to the API when the athlete opens the app from it, so
// the open rate can be measured (doc 10 1.1.2). Nothing else is sent.
struct PushOpen: Equatable {
  let kind: String
  let date: String
  let sentAt: Int

  init?(userInfo: [AnyHashable: Any]) {
    guard let s = userInfo["scora"] as? [String: Any],
          let kind = s["kind"] as? String, kind == "daily" || kind == "weekly",
          let date = s["date"] as? String, date.count == 10,
          let sentAt = (s["sent_at"] as? NSNumber)?.intValue
    else { return nil }
    self.kind = kind
    self.date = date
    self.sentAt = sentAt
  }
}

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
    #if DEBUG
    if DemoMode.isOn { return } // no system prompts over the demo screen
    #endif
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

  // The athlete tapped a scheduled push.
  func reportOpen(_ open: PushOpen) {
    guard
      let athleteId = UserDefaults.standard.string(forKey: athleteIdKey), !athleteId.isEmpty,
      let url = URL(string: "\(apiBase)/api/events/push-open")
    else { return }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(
      withJSONObject: ["athleteId": athleteId, "kind": open.kind, "date": open.date, "sentAt": open.sentAt]
    )
    URLSession.shared.dataTask(with: req).resume()
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

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Set before launch ends so a tap that launched the app is delivered here.
    UNUserNotificationCenter.current().delegate = self
    #if DEBUG
    // Demo mode (simulator checks, UI tests) never shows system prompts.
    if DemoMode.isOn { return true }
    #endif
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

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
       let open = PushOpen(userInfo: response.notification.request.content.userInfo) {
      PushManager.shared.reportOpen(open)
    }
    completionHandler()
  }
}
