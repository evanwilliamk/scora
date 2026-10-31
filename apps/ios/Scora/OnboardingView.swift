import SwiftUI

// Free-tier onboarding after Strava sign-in (doc 09 §1.1, §1.4, §1.5):
// Oura (optional) -> Apple Health -> plan paste (optional) -> time zone and
// morning time -> "Your first read lands tomorrow morning."
// Sign in with Apple and the Stripe customer step are not built (auth and
// payments wait on Evan).

enum OnboardingStep: Int, CaseIterable {
  case oura, health, plan, delivery, done

  var next: OnboardingStep? { OnboardingStep(rawValue: rawValue + 1) }

  // The step after `expected`, but only while this is still that step. A
  // second tap, a late network reply or a sheet dismissing after the athlete
  // already moved on leaves the flow where it is instead of skipping a screen.
  func advanced(from expected: OnboardingStep) -> OnboardingStep {
    guard self == expected, let next else { return self }
    return next
  }

  // VoiceOver reads the progress bar as one element.
  var progressLabel: String { "Step \(rawValue + 1) of \(OnboardingStep.allCases.count)" }
}

enum OnboardingState {
  static let key = "scora.needsOnboarding"

  // Set by a fresh sign-in only, so people already using the app are not
  // sent back through onboarding by an update.
  static var needsOnboarding: Bool {
    get { UserDefaults.standard.bool(forKey: key) }
    set { UserDefaults.standard.set(newValue, forKey: key) }
  }

  // The picker edits a plain time of day. Anchored to today in the phone's
  // zone, a daylight saving change day has no 2:30 (it became 3:30, sent as
  // 210) or two 1:30s. So the picker runs on a fixed day in UTC, which has no
  // such days; the phone's locale still decides 12 or 24 hour display.
  static let pickerCalendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "UTC")!
    c.locale = .autoupdatingCurrent
    return c
  }()
  private static let pickerDay = Date(timeIntervalSinceReferenceDate: 0) // 2001-01-01 00:00 UTC

  // Minutes after local midnight, as the API stores it.
  static func deliveryMinute(from date: Date, calendar: Calendar = pickerCalendar) -> Int {
    let c = calendar.dateComponents([.hour, .minute], from: date)
    return (c.hour ?? 6) * 60 + (c.minute ?? 0)
  }

  // The picker's value for a minute of the day.
  static func deliveryTime(minute: Int) -> Date {
    let m = ((minute % 1440) + 1440) % 1440
    return pickerDay.addingTimeInterval(TimeInterval(m * 60))
  }

  static func defaultDeliveryTime() -> Date { deliveryTime(minute: 6 * 60) }

  // "America/Los_Angeles" -> "Los Angeles"
  static func zoneLabel(_ zone: TimeZone) -> String {
    let id = zone.identifier
    let city = id.split(separator: "/").last.map(String.init) ?? id
    return city.replacingOccurrences(of: "_", with: " ")
  }
}

struct OnboardingView: View {
  @ObservedObject var tokenManager: TokenManager
  var onFinish: () -> Void
  @Environment(\.openURL) private var openURL

  @State private var step: OnboardingStep = .oura
  @State private var ouraConnected = false
  @State private var showPlan = false
  @State private var deliveryTime = OnboardingState.defaultDeliveryTime()
  @State private var isSaving = false
  @State private var errorText: String?
  @State private var requestingHealth = false

  private let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      progress.padding(.horizontal, 24).padding(.top, 24)
      Spacer(minLength: 24)
      content.padding(.horizontal, 24)
      Spacer()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
    .sheet(isPresented: $showPlan, onDismiss: { advance(from: .plan) }) {
      PlanView(tokenManager: tokenManager)
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ouraConnected"))) { _ in
      ouraConnected = true
      advance(from: .oura)
    }
  }

  private var progress: some View {
    HStack(spacing: 6) {
      ForEach(OnboardingStep.allCases, id: \.rawValue) { s in
        Capsule()
          .fill(s.rawValue <= step.rawValue ? Color.orange : Color(white: 0.2))
          .frame(height: 3)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(step.progressLabel)
  }

  @ViewBuilder
  private var content: some View {
    switch step {
    case .oura:
      screen(
        title: "Got an Oura ring? Add it.",
        body: "Oura's sleep and HRV signal makes every read sharper. Free tier, no extra cost.",
        primary: ("Connect Oura", connectOura),
        secondary: ("Skip for now", { advance(from: .oura) })
      )
    case .health:
      screen(
        title: "Apple Health",
        body: "SCORA reads sleep, HRV and resting heart rate from Apple Health. Without Oura, this is where the Sleep and Recovery cards come from.",
        primary: ("Allow Apple Health", requestHealth),
        secondary: nil
      )
    case .plan:
      screen(
        title: "Have a training plan?",
        body: "Paste your plan and SCORA reads it alongside your body.",
        primary: ("Paste a plan", { showPlan = true }),
        secondary: ("Skip", { advance(from: .plan) })
      )
    case .delivery:
      VStack(alignment: .leading, spacing: 16) {
        Text("Morning read")
          .scaledSerif(28, relativeTo: .title)
          .foregroundColor(.white)
        Text("Your read arrives as a notification each morning. Time zone: \(OnboardingState.zoneLabel(.current)).")
          .font(.body)
          .foregroundColor(.gray)
        DatePicker("Delivery time", selection: $deliveryTime, displayedComponents: .hourAndMinute)
          .datePickerStyle(.wheel)
          .labelsHidden()
          // Plain time of day: see OnboardingState.pickerCalendar.
          .environment(\.timeZone, OnboardingState.pickerCalendar.timeZone)
          .environment(\.calendar, OnboardingState.pickerCalendar)
          .colorScheme(.dark)
        if let errorText {
          Text(errorText).font(.footnote).foregroundColor(.gray)
        }
        primaryButton(isSaving ? "Saving..." : "Continue") {
          // Set before the task starts, so a quick second tap cannot send twice.
          guard !isSaving else { return }
          isSaving = true
          Task { await saveDelivery() }
        }
          .disabled(isSaving)
        if errorText != nil {
          Button("Skip for now") { skipDelivery() }
            .font(.subheadline)
            .foregroundColor(.gray)
            .frame(maxWidth: .infinity)
        }
      }
    case .done:
      screen(
        title: "Your first read lands tomorrow morning.",
        body: "Until then, today's numbers are already on the dashboard.",
        primary: ("Go to today", finish),
        secondary: nil
      )
    }
  }

  private func screen(title: String, body: String, primary: (String, () -> Void), secondary: (String, () -> Void)?) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(title)
        .scaledSerif(28, relativeTo: .title)
        .foregroundColor(.white)
        .fixedSize(horizontal: false, vertical: true)
      Text(body)
        .font(.body)
        .foregroundColor(.gray)
        .fixedSize(horizontal: false, vertical: true)
      primaryButton(primary.0, action: primary.1)
        .padding(.top, 8)
      if let secondary {
        Button(secondary.0, action: secondary.1)
          .font(.subheadline)
          .foregroundColor(.gray)
          .frame(maxWidth: .infinity)
      }
    }
  }

  private func primaryButton(_ label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(label)
        .font(.headline)
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color.orange)
        .foregroundColor(.black)
        .cornerRadius(8)
    }
  }

  // MARK: Actions

  private func advance(from expected: OnboardingStep) {
    withAnimation(.easeInOut(duration: 0.2)) {
      step = step.advanced(from: expected)
    }
  }

  // One permission request at a time: a double tap used to advance twice and
  // skip the plan screen.
  private func requestHealth() {
    guard !requestingHealth else { return }
    requestingHealth = true
    Task {
      _ = await HealthManager.shared.requestAuthorization()
      await MainActor.run {
        requestingHealth = false
        advance(from: .health)
      }
    }
  }

  private func connectOura() {
    guard let url = URL(string: "\(apiBase)/api/auth/oura?athlete_id=\(tokenManager.athleteId)") else { return }
    openURL(url)
  }

  private func finish() {
    tokenManager.finishOnboarding()
    onFinish()
  }

  // The save failed and the athlete moved on: keep the choice on the phone
  // so it is sent on the next launch or sign-in.
  private func skipDelivery() {
    OnboardingSync.keep(PendingOnboarding(
      athleteId: tokenManager.athleteId,
      timezone: TimeZone.current.identifier,
      deliveryMinute: OnboardingState.deliveryMinute(from: deliveryTime)
    ))
    advance(from: .delivery)
  }

  private func saveDelivery() async {
    guard let url = URL(string: "\(apiBase)/api/preferences") else { return }
    await MainActor.run { isSaving = true; errorText = nil }
    var req = URLRequest(url: url)
    req.httpMethod = "PUT"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "athleteId": tokenManager.athleteId,
      "timezone": TimeZone.current.identifier,
      "deliveryMinute": OnboardingState.deliveryMinute(from: deliveryTime),
      "onboarded": true,
    ] as [String: Any])
    let ok: Bool
    if let (_, resp) = try? await URLSession.shared.data(for: req) {
      ok = (resp as? HTTPURLResponse)?.statusCode == 200
      if ok {
        TimeZoneSync.remember(TimeZone.current.identifier)
        OnboardingSync.pending = nil
      }
    } else {
      ok = false
    }
    await MainActor.run {
      isSaving = false
      if ok { advance(from: .delivery) } else { errorText = "Could not save the time. The read still arrives at 6:00 until it is set." }
    }
  }
}

// The morning push follows the athlete's time zone: onboarding sends it once,
// and a trip changes it. When the app comes forward in a different zone, the
// new one is sent so delivery stays at the chosen local time.
enum TimeZoneSync {
  private static let key = "scora.sentTimezone"
  private static let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"
  static func remember(_ id: String) { UserDefaults.standard.set(id, forKey: key) }
  static func forget() { UserDefaults.standard.removeObject(forKey: key) }
  // True when the phone's zone is not the one last sent. With none recorded
  // (onboarded before this build, or signed in again) it is sent once.
  static func needsSync(current: String = TimeZone.current.identifier) -> Bool {
    UserDefaults.standard.string(forKey: key) != current
  }
  static func syncIfChanged(athleteId: String) async {
    let current = TimeZone.current.identifier
    guard needsSync(current: current), !athleteId.isEmpty,
          let url = URL(string: "\(apiBase)/api/preferences") else { return }
    var req = URLRequest(url: url)
    req.httpMethod = "PUT"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["athleteId": athleteId, "timezone": current])
    if let (_, resp) = try? await URLSession.shared.data(for: req), (resp as? HTTPURLResponse)?.statusCode == 200 {
      remember(current)
    }
  }
}

// An onboarding choice the API has not taken yet: "Skip for now" after a
// failed save. It stays on the phone and is sent again on the next launch or
// sign-in until the API accepts it, the way push-open reports are kept.
struct PendingOnboarding: Codable, Equatable {
  let athleteId: String
  let timezone: String
  let deliveryMinute: Int
}

enum OnboardingSync {
  static let pendingKey = "scora.pendingOnboarding"
  private static let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"

  // Sends one request and answers the status and body, or nil with no reply.
  // Tests swap it for a stub, so they never reach the network.
  typealias Transport = (URLRequest) async -> (Int, Data)?
  static var transport: Transport = { req in
    guard let (data, resp) = try? await URLSession.shared.data(for: req) else { return nil }
    return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
  }

  static var pending: PendingOnboarding? {
    get {
      guard let data = UserDefaults.standard.data(forKey: pendingKey) else { return nil }
      return try? JSONDecoder().decode(PendingOnboarding.self, from: data)
    }
    set {
      if let newValue, let data = try? JSONEncoder().encode(newValue) {
        UserDefaults.standard.set(data, forKey: pendingKey)
      } else {
        UserDefaults.standard.removeObject(forKey: pendingKey)
      }
    }
  }

  static func keep(_ choice: PendingOnboarding) { pending = choice }

  // True when this athlete has a choice waiting, so onboarding is done on the
  // phone even though the server does not know yet.
  static func hasPending(for athleteId: String) -> Bool { pending?.athleteId == athleteId }

  // Sends the waiting choice. True when nothing is left to send: delivered,
  // refused for good (a 4xx other than 408 or 429), or it belonged to another athlete (dropped, so it
  // is never sent under the wrong id).
  @discardableResult
  static func flush(athleteId: String) async -> Bool {
    guard let p = pending else { return true }
    guard p.athleteId == athleteId, !athleteId.isEmpty else { pending = nil; return true }
    guard let url = URL(string: "\(apiBase)/api/preferences") else { return false }
    var req = URLRequest(url: url)
    req.httpMethod = "PUT"
    // Sign-in waits on this; the system default would hold it for a minute.
    req.timeoutInterval = 10
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "athleteId": p.athleteId,
      "timezone": p.timezone,
      "deliveryMinute": p.deliveryMinute,
      "onboarded": true,
    ] as [String: Any])
    guard let (status, _) = await transport(req) else { return false }
    // Only clear the copy that was sent; a newer one saved meanwhile stays.
    if status == 200 {
      TimeZoneSync.remember(p.timezone)
      if pending == p { pending = nil }
      return true
    }
    if isFinalRefusal(status) {
      if pending == p { pending = nil }
      return true
    }
    return false
  }

  // A 4xx the API gives every time, so resending on each launch only repeats
  // it. A timeout (408) or rate limit (429) may pass next time.
  static func isFinalRefusal(_ status: Int) -> Bool {
    (400..<500).contains(status) && status != 408 && status != 429
  }

  // Whether the API has this athlete's onboarding on record (onboarded_at).
  // nil when it cannot be told: no reply, an error, an unreadable body.
  static func remoteOnboarded(athleteId: String) async -> Bool? {
    var c = URLComponents(string: "\(apiBase)/api/preferences")
    c?.queryItems = [URLQueryItem(name: "athleteId", value: athleteId)]
    guard !athleteId.isEmpty, let url = c?.url else { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = "GET"
    req.timeoutInterval = 10
    guard let (status, data) = await transport(req), status == 200,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let onboarded = json["onboarded"] as? Bool
    else { return nil }
    return onboarded
  }
}
