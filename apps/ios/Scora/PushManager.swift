import SwiftUI
import UserNotifications

// Handles APNs: request permission, capture the device token, and register it
// with the backend so SCORA can push the daily read. Registration needs both a
// device token and an athlete id, which can arrive in either order (token on
// launch, athlete id after sign-in) — sync() fires once both are present.
// The `scora` payload of a scheduled push (kind, local date, send time in
// unix seconds), echoed to the API when the athlete opens the app from it, so
// the open rate can be measured (doc 10 1.1.2). Nothing else is sent.
struct PushOpen: Equatable, Codable {
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

  // Reports waiting to be sent: the API refuses a send time over 7 days old,
  // so older ones are dropped, and the list stays short.
  static func pruned(_ items: [PushOpen], now: Date = Date()) -> [PushOpen] {
    let cutoff = Int(now.timeIntervalSince1970) - 7 * 86_400 + 3600
    var seen = Set<String>()
    let kept = items.filter { $0.sentAt >= cutoff && seen.insert("\($0.kind)|\($0.date)|\($0.sentAt)").inserted }
    return Array(kept.suffix(30))
  }
}

// Where a tap on a scheduled push lands (PRD §5.A.2): the daily read opens
// Today's Read at the top of the dashboard, the weekly one opens This Week.
enum PushRoute: Equatable {
  case todaysRead, weekly

  static let notice = Notification.Name("scoraOpenFromPush")
  // Set on the main thread by the tap; the dashboard takes it when it appears
  // or on the notice, whichever comes first (a tap can launch the app).
  static var pending: PushRoute?

  init(kind: String) { self = kind == "weekly" ? .weekly : .todaysRead }

  static func take() -> PushRoute? {
    defer { pending = nil }
    return pending
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
    flushOpens()
  }

  // The athlete tapped a scheduled push. Kept until the API has it, so an
  // open made offline or before sign-in still counts (doc 10 1.1.2).
  private let pendingKey = "scora.pendingPushOpens"
  private let pendingQueue = DispatchQueue(label: "scora.pushOpens")
  // Reports with a request out; touched only on pendingQueue. A second flush
  // (launch, then the tap) skips them, so one open is logged once.
  private var inFlight: [PushOpen] = []

  private func loadPending() -> [PushOpen] {
    guard let data = UserDefaults.standard.data(forKey: pendingKey) else { return [] }
    return (try? JSONDecoder().decode([PushOpen].self, from: data)) ?? []
  }

  private func savePending(_ items: [PushOpen]) {
    UserDefaults.standard.set(try? JSONEncoder().encode(items), forKey: pendingKey)
  }

  func reportOpen(_ open: PushOpen) {
    pendingQueue.async {
      self.savePending(PushOpen.pruned(self.loadPending() + [open]))
      self.flushOpens()
    }
  }

  // Signing out drops waiting reports, so they are never sent under the next
  // athlete's id.
  func clearPendingOpens() {
    pendingQueue.async { self.savePending([]) }
  }

  // Sends every waiting report; called on launch, after sign-in and after a tap.
  func flushOpens() {
    pendingQueue.async {
      let items = PushOpen.pruned(self.loadPending())
      self.savePending(items)
      guard
        !items.isEmpty,
        let athleteId = UserDefaults.standard.string(forKey: self.athleteIdKey), !athleteId.isEmpty,
        let url = URL(string: "\(self.apiBase)/api/events/push-open")
      else { return }
      for open in items where !self.inFlight.contains(open) {
        self.inFlight.append(open)
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(
          withJSONObject: ["athleteId": athleteId, "kind": open.kind, "date": open.date, "sentAt": open.sentAt]
        )
        URLSession.shared.dataTask(with: req) { _, resp, _ in
          let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
          self.pendingQueue.async {
            self.inFlight.removeAll { $0 == open }
            // Delivered, or refused for good (400): either way it leaves the list.
            if (200..<300).contains(status) || status == 400 {
              self.savePending(self.loadPending().filter { $0 != open })
            }
          }
        }.resume()
      }
    }
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
    PushManager.shared.flushOpens()
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
      DispatchQueue.main.async {
        PushRoute.pending = PushRoute(kind: open.kind)
        NotificationCenter.default.post(name: PushRoute.notice, object: nil)
      }
    }
    completionHandler()
  }
}
