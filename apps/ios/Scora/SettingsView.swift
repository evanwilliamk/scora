import SwiftUI

// Settings (Q40 A): the morning time, the connections, sign out. Uses the
// routes onboarding uses; there is no connections route, so what it says about
// Strava and Oura comes from the read already on the dashboard.

enum StravaStatus: Equatable {
  case connected, needsReconnect, unknown

  // The read is the only thing that tries Strava. A failure saying Strava
  // must be connected again is a real answer; any other failure (offline, an
  // outage) says nothing about the connection.
  static func of(hasRead: Bool, error: String?) -> StravaStatus {
    if let error {
      let e = error.lowercased()
      if e.contains("strava"), e.contains("connected again") || e.contains("reconnect") { return .needsReconnect }
      return .unknown
    }
    return hasRead ? .connected : .unknown
  }

  var line: String {
    switch self {
    case .connected: return "Connected."
    case .needsReconnect: return "Needs to be connected again."
    case .unknown: return "Shows once today's read has loaded."
    }
  }
}

enum OuraStatus: Equatable {
  case connected, notConnected, unknown

  // The read's own `connections.oura`. Not the cards: Sleep names "Oura /
  // Apple Health" as its source with no ring, and shows Apple Health numbers
  // with no connect prompt. An older reply without the field says nothing.
  static func of(connected: Bool?) -> OuraStatus {
    guard let connected else { return .unknown }
    return connected ? .connected : .notConnected
  }

  var line: String {
    switch self {
    case .connected: return "Connected."
    case .notConnected: return "Not connected."
    case .unknown: return "Shows once today's read has loaded."
    }
  }

  var buttonLabel: String { self == .notConnected ? "Connect Oura" : "Reconnect Oura" }
}

// Reconnect Strava goes through the sign-in link, which answers with whichever
// Strava account the athlete chose in the browser. Started from Settings, a
// different account must not replace the signed-in athlete with the first
// athlete's read still on screen, so that answer is dropped.
enum StravaReconnect {
  static let key = "scora.stravaReconnectFor"
  static let reconnected = Notification.Name("stravaReconnected")
  static let connectedLine = "Strava connected."
  static let otherAccountLine = "That was a different Strava account. Nothing changed."

  enum Outcome: Equatable { case signIn, reconnected, otherAccount }

  static func begin(athleteId: String) { UserDefaults.standard.set(athleteId, forKey: key) }
  static func clear() { UserDefaults.standard.removeObject(forKey: key) }
  static var pendingFor: String? { UserDefaults.standard.string(forKey: key) }

  static func outcome(incoming: String, pendingFor: String?) -> Outcome {
    guard let pendingFor else { return .signIn }
    return incoming == pendingFor ? .reconnected : .otherAccount
  }
}

enum SettingsPrefs {
  private static let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"

  // The time to show: a choice still waiting on the phone is newer than the
  // server's, and will overwrite it when it is sent.
  static func shownMinute(remote: Int, pending: PendingOnboarding?, athleteId: String) -> Int {
    if let pending, pending.athleteId == athleteId { return pending.deliveryMinute }
    return remote
  }

  // The athlete's saved minute, or nil when it cannot be told.
  static func load(athleteId: String) async -> Int? {
    var c = URLComponents(string: "\(apiBase)/api/preferences")
    c?.queryItems = [URLQueryItem(name: "athleteId", value: athleteId)]
    guard !athleteId.isEmpty, let url = c?.url else { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = "GET"
    guard let (status, data) = await OnboardingSync.transport(req), status == 200,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let minute = json["deliveryMinute"] as? Int
    else { return nil }
    return shownMinute(remote: minute, pending: OnboardingSync.pending, athleteId: athleteId)
  }

  // Saves the time and the phone's zone. `onboarded` is sent because a waiting
  // onboarding choice is replaced here and it carried that mark; the server
  // sets it once, so it never moves.
  static func save(athleteId: String, minute: Int, zone: String = TimeZone.current.identifier) async -> Bool {
    guard !athleteId.isEmpty, let url = URL(string: "\(apiBase)/api/preferences") else { return false }
    var req = URLRequest(url: url)
    req.httpMethod = "PUT"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "athleteId": athleteId,
      "timezone": zone,
      "deliveryMinute": minute,
      "onboarded": true,
    ] as [String: Any])
    guard let (status, _) = await OnboardingSync.transport(req), status == 200 else { return false }
    // A reply that outlived a sign-out records nothing (see keepsRecord).
    if TimeZoneSync.keepsRecord(sentFor: athleteId, signedIn: UserDefaults.standard.string(forKey: "scora.athleteId")) {
      TimeZoneSync.remember(zone)
    }
    if OnboardingSync.pending?.athleteId == athleteId { OnboardingSync.pending = nil }
    return true
  }
}

struct SettingsView: View {
  @ObservedObject var tokenManager: TokenManager
  let strava: StravaStatus
  let oura: OuraStatus
  var onConnectStrava: () -> Void
  var onConnectOura: () -> Void
  @Environment(\.dismiss) private var dismiss

  // nil until the saved time is known: a default on the wheel would read as
  // the athlete's own time.
  @State private var savedMinute: Int?
  @State private var picked = OnboardingState.defaultDeliveryTime()
  @State private var loadFailed = false
  @State private var isSaving = false
  @State private var statusLine: String?

  private var pickedMinute: Int { OnboardingState.deliveryMinute(from: picked) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Settings")
          .font(.headline.bold())
          .foregroundColor(.white)
          .accessibilityAddTraits(.isHeader)
        Spacer()
        Button { dismiss() } label: { Text("Done").minTapTarget() }.foregroundColor(.orange)
      }
      .padding(.horizontal)
      .padding(.vertical, 6)
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          delivery
          connections
          signOut
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
    .task { await load() }
  }

  private func sectionTitle(_ text: String) -> some View {
    Text(text)
      .scaledSerif(22, relativeTo: .title3)
      .foregroundColor(.white)
      .accessibilityAddTraits(.isHeader)
  }

  private var delivery: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionTitle("Morning read")
      Text("Time zone: \(OnboardingState.zoneLabel(.current)).")
        .font(.body)
        .foregroundColor(.gray)
      if savedMinute != nil {
        DatePicker("Delivery time", selection: $picked, displayedComponents: .hourAndMinute)
          .datePickerStyle(.wheel)
          .labelsHidden()
          // Plain time of day: see OnboardingState.pickerCalendar.
          .environment(\.timeZone, OnboardingState.pickerCalendar.timeZone)
          .environment(\.calendar, OnboardingState.pickerCalendar)
          .colorScheme(.dark)
          .onChange(of: picked) { _, _ in statusLine = nil }
        if pickedMinute != savedMinute {
          button(isSaving ? "Saving..." : "Save time", filled: true) {
            // Set before the task starts, so a quick second tap cannot send twice.
            guard !isSaving else { return }
            isSaving = true
            let minute = pickedMinute
            Task { await save(minute) }
          }
          .disabled(isSaving)
        }
      } else if loadFailed {
        Text("Could not load your delivery time.")
          .font(.subheadline)
          .foregroundColor(.gray)
        button("Try again", filled: false) { Task { await load() } }
      } else {
        ProgressView().frame(maxWidth: .infinity, minHeight: 44)
      }
      if let statusLine {
        Text(statusLine)
          .font(.footnote)
          .foregroundColor(.gray)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var connections: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionTitle("Connections")
      connection("Strava", line: strava.line)
      button("Reconnect Strava", filled: strava == .needsReconnect) {
        dismiss()
        onConnectStrava()
      }
      connection("Oura", line: oura.line)
      button(oura.buttonLabel, filled: false) {
        dismiss()
        onConnectOura()
      }
    }
  }

  private func connection(_ name: String, line: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(name).font(.body).foregroundColor(.white)
      Text(line).font(.subheadline).foregroundColor(.gray).fixedSize(horizontal: false, vertical: true)
    }
    .accessibilityElement(children: .combine)
  }

  private var signOut: some View {
    button("Sign Out", filled: false) {
      #if DEBUG
      if DemoMode.isOn { tokenManager.isAuthenticated = false; return } // nothing stored, no network
      #endif
      tokenManager.logout()
    }
  }

  private func button(_ label: String, filled: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(label)
        .font(.headline)
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
        .background(filled ? Color.orange : Color(white: 0.16))
        .foregroundColor(filled ? .black : .orange)
        .cornerRadius(8)
    }
  }

  private func load() async {
    loadFailed = false
    #if DEBUG
    if DemoMode.isOn {
      if DemoMode.settingsLoadFails { loadFailed = true } else { apply(390) }
      return
    }
    #endif
    if let minute = await SettingsPrefs.load(athleteId: tokenManager.athleteId) {
      apply(minute)
    } else {
      loadFailed = true
    }
  }

  private func apply(_ minute: Int) {
    savedMinute = minute
    picked = OnboardingState.deliveryTime(minute: minute)
  }

  private func save(_ minute: Int) async {
    let ok: Bool
    #if DEBUG
    if DemoMode.isOn {
      ok = !DemoMode.deliveryFails
    } else {
      ok = await SettingsPrefs.save(athleteId: tokenManager.athleteId, minute: minute)
    }
    #else
    ok = await SettingsPrefs.save(athleteId: tokenManager.athleteId, minute: minute)
    #endif
    isSaving = false
    if ok {
      savedMinute = minute
      statusLine = "Saved. Your read arrives at \(OnboardingState.timeLabel(minute: minute))."
    } else {
      statusLine = "Could not save the time. Your read keeps its current time."
    }
  }
}
