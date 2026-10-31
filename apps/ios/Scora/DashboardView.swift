import SwiftUI

// MARK: - Models

struct DailyRead: Decodable {
  let voice: String
  // "Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412" (PRD §5.A.2).
  // Optional so older API builds still decode.
  var numbers: String? = nil
  // Plan tier inline charts (DriverChart.swift). Absent when the server has
  // them off.
  let links: [DriverLink]?
  let series: [String: DriverSeries]?
  // "Today: 45-minute tempo. ..." for a session SCORA built; absent otherwise.
  var today: String? = nil
}

struct DashboardCard: Decodable, Identifiable {
  let id: String
  let title: String
  let available: Bool
  let value: String?
  let unit: String?
  let translation: String?
  let trend: String?
  let source: String?
  let cta: String?
  // The API's explicit connect flag. `.absent` means an older API that does
  // not send it; `.none` means the source is linked (or not needed).
  var connect: ConnectFlag = .absent

  enum ConnectFlag: Equatable {
    case absent
    case none
    case source(String) // "oura", "strava", "healthkit"
  }

  private enum CodingKeys: String, CodingKey {
    case id, title, available, value, unit, translation, trend, source, cta, connect
  }
}

extension DashboardCard {
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    title = try c.decode(String.self, forKey: .title)
    available = try c.decode(Bool.self, forKey: .available)
    value = try c.decodeIfPresent(String.self, forKey: .value)
    unit = try c.decodeIfPresent(String.self, forKey: .unit)
    translation = try c.decodeIfPresent(String.self, forKey: .translation)
    trend = try c.decodeIfPresent(String.self, forKey: .trend)
    source = try c.decodeIfPresent(String.self, forKey: .source)
    cta = try c.decodeIfPresent(String.self, forKey: .cta)
    if !c.contains(.connect) {
      connect = .absent
    } else if try c.decodeNil(forKey: .connect) {
      connect = .none
    } else {
      // An unknown value from a newer API is read as no connect action.
      connect = (try? c.decode(String.self, forKey: .connect)).map { .source($0) } ?? .none
    }
  }
}

extension DashboardCard {
  static let unavailableLine = "Not available yet."
  static let connectOuraLine = "Connect Oura"

  enum TapKind: Equatable { case connectOura, expand, none }

  // Only a card that asks the athlete to connect Oura offers the link. With
  // Oura already linked, a night with no data says so ("No sleep recorded
  // last night.") and is not a reason to sign in again.
  // The API's `connect` flag decides when it is sent; an older API without
  // it falls back to reading the prompt text.
  var offersOuraConnect: Bool {
    guard !available else { return false }
    switch connect {
    case .source(let s): return s == "oura"
    case .none: return false
    case .absent:
      guard source?.contains("Oura") ?? false else { return false }
      return cta.map { $0.hasPrefix("Connect") } ?? true
    }
  }

  var tapKind: TapKind {
    if offersOuraConnect { return .connectOura }
    if available, translation != nil { return .expand }
    return .none
  }

  // Long Effort run today arrives with an empty unit; nothing is drawn for it.
  var shownUnit: String? {
    guard let unit, !unit.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    return unit
  }

  // What VoiceOver reads for the whole card, from the API's own strings.
  var spokenLabel: String {
    let body: String
    if available, let value {
      body = [[value, shownUnit].compactMap { $0 }.joined(separator: " "), trend]
        .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    } else {
      body = cta ?? Self.unavailableLine
    }
    var line = "\(title), \(body)"
    if !line.hasSuffix(".") { line += "." }
    if let source, !source.isEmpty { line += " From \(source.replacingOccurrences(of: " / ", with: " or "))." }
    return line
  }
}

// Read loads can overlap (pull to refresh while an Oura or plan change reload
// is in flight). A reply lands unless a newer one already has, so an older
// reply arriving late never puts the earlier numbers back, and a newer load
// that fails never throws away the only read that came back. Errors and the
// spinner follow the newest load alone.
struct ReadLoadGate {
  private(set) var current = 0
  private(set) var applied = 0
  mutating func begin() -> Int { current += 1; return current }
  func isLatest(_ token: Int) -> Bool { token == current }
  mutating func accept(_ token: Int) -> Bool {
    guard token > applied else { return false }
    applied = token
    return true
  }
}

// What the top of Today's Read shows besides the read itself.
enum ReadStatus: Equatable {
  case shown
  case staleWithError(String) // a refresh failed; the earlier read stays
  case loading
  case error(String)
  case empty

  static let emptyLine = "Pull to refresh your read."
  static let loadingLine = "Reading…"

  static func of(hasRead: Bool, isLoading: Bool, error: String?) -> ReadStatus {
    if hasRead { return error.map { .staleWithError($0) } ?? .shown }
    if isLoading { return .loading }
    if let error { return .error(error) }
    return .empty
  }
}

// /api/card-expand reply: a 2-3 sentence read of one card.
struct CardExpansion: Decodable {
  let cardId: String
  let reply: String
  let generated: Bool?

  // An expansion requested before the latest read cites old numbers.
  static func isCurrent(requested: Int, current: Int) -> Bool { requested == current }

  // What an open card shows: the expansion once it lands, else the card's own
  // translation. An empty reply never blanks the card.
  static func text(reply: String?, translation: String?) -> String? {
    if let reply, !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return reply }
    if let translation, !translation.isEmpty { return translation }
    return nil
  }
}

struct ReadPosture: Decodable, Equatable {
  let posture: String
}

struct ReadResponse: Decodable {
  let read: DailyRead
  let posture: ReadPosture?
  let weekSoFar: WeekSoFar?
  let cards: [DashboardCard]
  let generatedAt: String?
}

// Outcome of the Oura OAuth round trip, from scora://oura/success or
// scora://oura/failed?reason=...
struct OuraLinkResult: Equatable {
  static let notification = Notification.Name("ouraLinkResult")

  let connected: Bool
  let message: String

  init?(url: URL) {
    guard url.scheme == "scora", url.host == "oura" else { return nil }
    switch url.path {
    case "/success":
      connected = true
      message = "Oura connected. Sleep and recovery now read from your ring."
    case "/failed":
      connected = false
      let reason = URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?.first(where: { $0.name == "reason" })?.value
      message = reason == "cancelled"
        ? "Oura was not connected. You can try again from the Sleep card."
        : "Oura did not connect. Nothing changed; try again from the Sleep card."
    default:
      return nil
    }
  }
}

// MARK: - View

struct DashboardView: View {
  @ObservedObject var tokenManager: TokenManager
  @Environment(\.openURL) private var openURL
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.dynamicTypeSize) private var typeSize
  // The local day the shown read was made for: a new day means a new read.
  @State private var loadedDay: String?
  @State private var loadedAt: Date?

  @State private var read: DailyRead?
  @State private var posture: String?
  @State private var week: WeekSoFar?
  @State private var cards: [DashboardCard] = []
  @State private var isLoading = false
  @State private var errorText: String?
  @State private var expanded: Set<String> = []
  @State private var expansions: [String: String] = [:]
  @State private var expanding: Set<String> = []
  // Bumped on every new read; an expansion from an older read is dropped.
  @State private var readGeneration = 0
  @State private var loadGate = ReadLoadGate()
  @State private var showChat = false
  @State private var showWeekly = false
  @State private var ouraBanner: OuraLinkResult?
  @State private var showPlan = false
  @State private var chartSeries: DriverSeries?

  private let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"

  // Two cards a row; one at the accessibility text sizes, where half a
  // screen cannot hold a value and its unit.
  private var columns: [GridItem] {
    Array(repeating: GridItem(.flexible(), spacing: 12), count: typeSize.isAccessibilitySize ? 1 : 2)
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      if let ouraBanner {
        Text(ouraBanner.message)
          .font(.footnote)
          .foregroundColor(ouraBanner.connected ? .white : Color(white: 0.85))
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 16)
          .padding(.vertical, 10)
          .background(ouraBanner.connected ? Color.orange.opacity(0.25) : Color(white: 0.16))
          .transition(.move(edge: .top).combined(with: .opacity))
          .onTapGesture { withAnimation { self.ouraBanner = nil } }
      }
      ScrollViewReader { scroller in
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          todaysRead
            .id("top")
          if let week { WeekSoFarView(week: week) }
          if !cards.isEmpty {
            LazyVGrid(columns: columns, spacing: 12) {
              ForEach(cards) { card in
                cardView(card)
              }
            }
          }
          if case .error(let message) = ReadStatus.of(hasRead: read != nil, isLoading: isLoading, error: errorText) {
            Text(message)
              .font(.subheadline)
              .foregroundColor(.gray)
              .frame(maxWidth: .infinity, alignment: .center)
              .padding(.top, 40)
          }
        }
        .padding()
      }
      .refreshable { await loadRead() }
      .onAppear { followPush(scroller) }
      .onReceive(NotificationCenter.default.publisher(for: PushRoute.notice)) { _ in followPush(scroller) }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
    .sheet(isPresented: $showChat) {
      ChatView(tokenManager: tokenManager)
    }
    .sheet(isPresented: $showWeekly) {
      WeeklyView(tokenManager: tokenManager)
    }
    .sheet(item: $chartSeries) { series in
      DriverChartView(series: series)
    }
    .sheet(isPresented: $showPlan) {
      PlanView(tokenManager: tokenManager)
    }
    .task {
      if read == nil {
        #if DEBUG
        if DemoMode.isOn { await loadRead(); return }
        #endif
        _ = await HealthManager.shared.requestAuthorization()
        await loadRead()
        await TimeZoneSync.syncIfChanged(athleteId: tokenManager.athleteId)
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ouraConnected"))) { _ in
      Task { await loadRead() }
    }
    .onReceive(NotificationCenter.default.publisher(for: OuraLinkResult.notification)) { note in
      guard let result = note.object as? OuraLinkResult else { return }
      withAnimation { ouraBanner = result }
      Task {
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        await MainActor.run {
          if ouraBanner == result { withAnimation { ouraBanner = nil } }
        }
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("planChanged"))) { _ in
      Task { await loadRead() }
    }
    // Back from overnight in the background: yesterday's read is not today's.
    .onChange(of: scenePhase) { _, phase in
      guard phase == .active else { return }
      // A new day, or a read over three hours old (a 6 AM read can predate
      // the Watch's sleep sync), is read again.
      let stale = loadedAt.map { Date().timeIntervalSince($0) > 3 * 3600 } ?? false
      if loadedDay != nil, !isLoading, loadedDay != PlanDay.today() || stale { Task { await loadRead() } }
      Task { await TimeZoneSync.syncIfChanged(athleteId: tokenManager.athleteId) }
    }
  }

  // A tapped push (PRD §5.A.2): close whatever is open over the dashboard, then
  // show Today's Read at the top, or This Week for the weekly review.
  private func followPush(_ scroller: ScrollViewProxy) {
    guard let route = PushRoute.take() else { return }
    let otherSheetOpen = showChat || showPlan || chartSeries != nil
    showChat = false
    showPlan = false
    chartSeries = nil
    switch route {
    case .weekly:
      // SwiftUI will not present a sheet while another is closing, so This
      // Week waits for the other one to go.
      if otherSheetOpen {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { showWeekly = true }
      } else {
        showWeekly = true
      }
    case .todaysRead:
      showWeekly = false
      withAnimation { scroller.scrollTo("top", anchor: .top) }
      // The morning push opens today's read, never the one left from yesterday.
      if let day = loadedDay, day != PlanDay.today(), !isLoading { Task { await loadRead() } }
    }
  }

  // Kick off the Oura OAuth flow in the browser; on return the app receives a
  // scora://oura/success deep link and reloads the dashboard.
  private func connectOura() {
    guard let url = URL(string: "\(apiBase)/api/auth/oura?athlete_id=\(tokenManager.athleteId)")
    else { return }
    openURL(url)
  }

  // MARK: Header

  private var header: some View {
    HStack {
      Text("SCORA")
        .font(.headline.bold())
        .foregroundColor(.white)
      Spacer()
      Button(action: { showPlan = true }) {
        Image(systemName: "list.bullet.rectangle")
          .foregroundColor(.orange)
      }
      .accessibilityLabel("Your plan")
      .padding(.trailing, 4)
      Button(action: { showWeekly = true }) {
        Image(systemName: "calendar")
          .foregroundColor(.orange)
      }
      .accessibilityLabel("This week")
      .padding(.trailing, 4)
      Button(action: { showChat = true }) {
        Image(systemName: "bubble.left.and.bubble.right")
          .foregroundColor(.orange)
      }
      .accessibilityLabel("Ask about your training")
      Button("Sign Out") { tokenManager.logout() }
        .font(.subheadline)
        .foregroundColor(.orange)
        .padding(.leading, 8)
    }
    .padding()
    .background(Color.black)
  }

  // MARK: Today's Read

  private var todaysRead: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Today's Read")
        .font(.caption.bold())
        .foregroundColor(.gray)
        .textCase(.uppercase)

      if let read {
        // Posture badge and the raw numbers first (PRD §5.A.3, CLAUDE.md §3.3).
        // The numbers drop under the badge at large text sizes instead of clipping.
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 8) { postureAndNumbers(read) }
          VStack(alignment: .leading, spacing: 6) { postureAndNumbers(read) }
        }
        Text(ReadText.attributed(read.voice, links: read.links ?? [], series: read.series ?? [:]))
          .scaledSerif(20)
          .foregroundColor(.white)
          .tint(.orange)
          .fixedSize(horizontal: false, vertical: true)
          .environment(\.openURL, OpenURLAction { url in
            guard let key = ReadText.seriesKey(url) else { return .systemAction }
            chartSeries = read.series?[key]
            return .handled
          })
        // The plan's session for today (CLAUDE.md §3.3), only on a SCORA plan.
        if let today = read.today, !today.isEmpty {
          Text(today).font(.footnote).foregroundColor(.orange)
            .fixedSize(horizontal: false, vertical: true)
        }
        // A refresh that failed leaves the earlier read up, and says so.
        if case .staleWithError(let message) = ReadStatus.of(hasRead: true, isLoading: isLoading, error: errorText) {
          Text(message)
            .font(.caption)
            .foregroundColor(.gray)
            .fixedSize(horizontal: false, vertical: true)
        }
      } else if isLoading {
        HStack(spacing: 10) {
          ProgressView().tint(.white)
          Text(ReadStatus.loadingLine).foregroundColor(.gray).font(.subheadline)
        }
        .padding(.vertical, 8)
      } else if errorText == nil {
        // A failed first load shows its own line below; no second prompt here.
        Text(ReadStatus.emptyLine)
          .font(.subheadline)
          .foregroundColor(.gray)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.bottom, 4)
  }

  @ViewBuilder
  private func postureAndNumbers(_ read: DailyRead) -> some View {
    if let p = posture {
      Text(p)
        .font(.caption.bold())
        .foregroundColor(.black)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(Color.orange.opacity(0.85))
        .clipShape(Capsule())
        .accessibilityLabel("Posture: \(p)")
    }
    if let n = read.numbers, !n.isEmpty {
      Text(n).font(.footnote.monospacedDigit()).foregroundColor(.gray)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  // MARK: Card

  @ViewBuilder
  private func cardView(_ card: DashboardCard) -> some View {
    let isOpen = expanded.contains(card.id)
    let tap = card.tapKind
    let openText = isOpen ? CardExpansion.text(reply: expansions[card.id], translation: card.translation) : nil
    VStack(alignment: .leading, spacing: 8) {
      Text(card.title)
        .font(.caption.bold())
        .foregroundColor(.gray)

      if card.available, let value = card.value {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          // Scales with Dynamic Type; a long word ("Nothing", "Today")
          // shrinks to fit the card rather than truncating.
          Text(value)
            .font(.title.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .foregroundColor(.white)
          if let unit = card.shownUnit {
            Text(unit)
              .font(.caption)
              .foregroundColor(.gray)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        if let trend = card.trend, !trend.isEmpty {
          Text(trend)
            .font(.caption)
            .foregroundColor(.orange)
            .fixedSize(horizontal: false, vertical: true)
        }
      } else {
        // Unavailable card: connect prompt, no fabricated number.
        Text(card.cta ?? DashboardCard.unavailableLine)
          .font(.footnote)
          .foregroundColor(.gray)
          .fixedSize(horizontal: false, vertical: true)
        if tap == .connectOura {
          Text("\(DashboardCard.connectOuraLine) \(Image(systemName: "arrow.right"))")
            .font(.caption.bold())
            .foregroundColor(.orange)
            .padding(.top, 2)
        }
      }

      if let openText {
        Text(openText)
          .font(.footnote)
          .foregroundColor(Color(white: 0.75))
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 2)
          .opacity(expanding.contains(card.id) ? 0.6 : 1)
      }

      if let source = card.source {
        Text(source)
          .font(.caption2)
          .foregroundColor(Color(white: 0.4))
          .padding(.top, 2)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
    .padding(14)
    .background(Color(white: 0.11))
    .cornerRadius(12)
    .contentShape(Rectangle())
    .onTapGesture { tapCard(card) }
    // One VoiceOver stop per card, read from the same strings it shows.
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(card.spokenLabel)
    .accessibilityValue(openText ?? "")
    .accessibilityAddTraits(tap == .none ? [] : .isButton)
    .accessibilityHint(tap == .connectOura ? "Opens Oura to connect it." : tap == .expand ? (isOpen ? "Hides the explanation." : "Shows what this means.") : "")
    .accessibilityAction { tapCard(card) }
  }

  private func tapCard(_ card: DashboardCard) {
    switch card.tapKind {
    case .connectOura:
      connectOura()
    case .expand:
      let isOpen = expanded.contains(card.id)
      withAnimation(.easeInOut(duration: 0.15)) {
        if isOpen { expanded.remove(card.id) } else { expanded.insert(card.id) }
      }
      if !isOpen, expansions[card.id] == nil, !expanding.contains(card.id) {
        Task { await loadExpansion(card.id) }
      }
    case .none:
      return
    }
  }

  // MARK: Networking

  // Card tap-to-expand. Any failure (offline, read expired) keeps the card's
  // own translation on screen.
  private func loadExpansion(_ cardId: String) async {
    guard let url = URL(string: "\(apiBase)/api/card-expand") else { return }
    let generation = await MainActor.run { () -> Int in
      expanding.insert(cardId)
      return readGeneration
    }
    defer { Task { @MainActor in expanding.remove(cardId) } }

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "athleteId": tokenManager.athleteId, "cardId": cardId,
    ])
    guard let (data, resp) = try? await URLSession.shared.data(for: req),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(CardExpansion.self, from: data)
    else { return }
    await MainActor.run {
      if CardExpansion.isCurrent(requested: generation, current: readGeneration) { expansions[cardId] = decoded.reply }
    }
  }

  private func loadRead() async {
    #if DEBUG
    if DemoMode.isOn {
      await MainActor.run {
        read = DemoMode.read
        // With sample SCORA sessions, the read carries today's line as the API would.
        if DemoMode.planSessions != nil { read?.today = "Today: 40-minute easy run." }
        posture = "steady"
        week = DemoMode.week
        if let demoCards = DemoMode.cards { cards = demoCards }
        if DemoMode.opensChart { chartSeries = DemoMode.read.series?["hrv"] }
        if DemoMode.opensPlan { showPlan = true }
        if DemoMode.opensWeekly { showWeekly = true }
        if DemoMode.opensChat { showChat = true }
      }
      return
    }
    #endif
    guard let url = URL(string: "\(apiBase)/api/read") else { return }
    let token = await MainActor.run { () -> Int in
      isLoading = true; errorText = nil
      return loadGate.begin()
    }
    // The day the read is asked for is the day it is shown as, even if the
    // reply lands after midnight.
    let day = PlanDay.today()

    // HealthKit is on-device: read a summary and send it up so the backend can
    // fill Sleep + Recovery when Oura isn't connected.
    // The local date lets the read find today's session in the athlete's plan
    // and the plan engine evaluate the athlete's tomorrow, not the server's.
    var payload: [String: Any] = ["athleteId": tokenManager.athleteId, "today": day]
    if let health = await HealthManager.shared.fetchSummary(),
       let encoded = try? JSONEncoder().encode(health),
       let dict = try? JSONSerialization.jsonObject(with: encoded) as? [String: Any] {
      payload["health"] = dict
    }

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

    do {
      let (data, resp) = try await URLSession.shared.data(for: req)
      if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
        let msg = APIErrorText.message(from: data, fallback: "The read could not load. Pull to try again.")
        await MainActor.run {
          guard loadGate.isLatest(token) else { return }
          errorText = msg; isLoading = false
        }
        return
      }
      let decoded = try JSONDecoder().decode(ReadResponse.self, from: data)
      await MainActor.run {
        // A newer reply already landed: this one is older news.
        guard loadGate.accept(token) else { return }
        read = decoded.read
        posture = decoded.posture?.posture
        week = decoded.weekSoFar
        cards = decoded.cards
        expansions = [:] // a new read means new numbers to interpret
        readGeneration += 1
        loadedDay = day
        loadedAt = Date()
        // A newer load still in flight keeps the spinner.
        if loadGate.isLatest(token) { isLoading = false }
      }
    } catch {
      await MainActor.run {
        guard loadGate.isLatest(token) else { return }
        errorText = "The read could not load. Pull to try again."; isLoading = false
      }
    }
  }
}

// What an API failure says to the athlete: the server's own `error` sentence
// when the body has one, else a fixed line. Never a raw body (a proxy's HTML
// page or a framework's JSON).
enum APIErrorText {
  private struct Body: Decodable { let error: String }
  static func message(from data: Data, fallback: String) -> String {
    guard let text = (try? JSONDecoder().decode(Body.self, from: data))?.error,
          !text.isEmpty, text.count <= 200, !text.contains("<") else { return fallback }
    return text
  }
}

// The voice's serif, at its designed size by default and scaling with the
// reader's Dynamic Type setting from there.
struct ScaledSerif: ViewModifier {
  @ScaledMetric private var size: CGFloat

  init(_ base: CGFloat, relativeTo style: Font.TextStyle) {
    _size = ScaledMetric(wrappedValue: base, relativeTo: style)
  }

  func body(content: Content) -> some View {
    content.font(.system(size: size, weight: .regular, design: .serif))
  }
}

extension View {
  func scaledSerif(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> some View {
    modifier(ScaledSerif(size, relativeTo: style))
  }
}
