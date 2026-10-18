import SwiftUI

// MARK: - Models

struct DailyRead: Decodable {
  let voice: String
  // Plan tier inline charts (DriverChart.swift). Absent when the server has
  // them off.
  let links: [DriverLink]?
  let series: [String: DriverSeries]?
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

struct ReadResponse: Decodable {
  let read: DailyRead
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

  @State private var read: DailyRead?
  @State private var cards: [DashboardCard] = []
  @State private var isLoading = false
  @State private var errorText: String?
  @State private var expanded: Set<String> = []
  @State private var expansions: [String: String] = [:]
  @State private var expanding: Set<String> = []
  // Bumped on every new read; an expansion from an older read is dropped.
  @State private var readGeneration = 0
  @State private var showChat = false
  @State private var showWeekly = false
  @State private var ouraBanner: OuraLinkResult?
  @State private var showPlan = false
  @State private var chartSeries: DriverSeries?

  private let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"

  private let columns = [
    GridItem(.flexible(), spacing: 12),
    GridItem(.flexible(), spacing: 12),
  ]

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
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          todaysRead
          if !cards.isEmpty {
            LazyVGrid(columns: columns, spacing: 12) {
              ForEach(cards) { card in
                cardView(card)
              }
            }
          }
          if let errorText, read == nil {
            Text(errorText)
              .font(.subheadline)
              .foregroundColor(.gray)
              .frame(maxWidth: .infinity, alignment: .center)
              .padding(.top, 40)
          }
        }
        .padding()
      }
      .refreshable { await loadRead() }
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
        _ = await HealthManager.shared.requestAuthorization()
        await loadRead()
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
      .padding(.trailing, 4)
      Button(action: { showChat = true }) {
        Image(systemName: "bubble.left.and.bubble.right")
          .foregroundColor(.orange)
      }
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
        Text(ReadText.attributed(read.voice, links: read.links ?? [], series: read.series ?? [:]))
          .font(.system(size: 20, weight: .regular, design: .serif))
          .foregroundColor(.white)
          .tint(.orange)
          .fixedSize(horizontal: false, vertical: true)
          .environment(\.openURL, OpenURLAction { url in
            guard let key = ReadText.seriesKey(url) else { return .systemAction }
            chartSeries = read.series?[key]
            return .handled
          })
      } else if isLoading {
        HStack(spacing: 10) {
          ProgressView().tint(.white)
          Text("Reading…").foregroundColor(.gray).font(.subheadline)
        }
        .padding(.vertical, 8)
      } else {
        Text("Pull to refresh your read.")
          .font(.subheadline)
          .foregroundColor(.gray)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.bottom, 4)
  }

  // MARK: Card

  // An unavailable card whose data comes from Oura offers a tap-to-connect.
  private func isOuraConnectable(_ card: DashboardCard) -> Bool {
    !card.available && (card.source?.contains("Oura") ?? false)
  }

  @ViewBuilder
  private func cardView(_ card: DashboardCard) -> some View {
    let isOpen = expanded.contains(card.id)
    let connectable = isOuraConnectable(card)
    VStack(alignment: .leading, spacing: 8) {
      Text(card.title)
        .font(.caption.bold())
        .foregroundColor(.gray)

      if card.available, let value = card.value {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          Text(value)
            .font(.system(size: 30, weight: .semibold))
            .foregroundColor(.white)
          if let unit = card.unit {
            Text(unit)
              .font(.caption)
              .foregroundColor(.gray)
          }
        }
        if let trend = card.trend, !trend.isEmpty {
          Text(trend)
            .font(.caption)
            .foregroundColor(.orange)
        }
      } else {
        // Unavailable card: connect prompt, no fabricated number.
        Text(card.cta ?? "Not available yet.")
          .font(.footnote)
          .foregroundColor(.gray)
          .fixedSize(horizontal: false, vertical: true)
        if connectable {
          Text("Connect Oura →")
            .font(.caption.bold())
            .foregroundColor(.orange)
            .padding(.top, 2)
        }
      }

      if isOpen, let text = CardExpansion.text(reply: expansions[card.id], translation: card.translation) {
        Text(text)
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
      }
    }
    .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
    .padding(14)
    .background(Color(white: 0.11))
    .cornerRadius(12)
    .onTapGesture {
      if connectable {
        connectOura()
        return
      }
      guard card.available, card.translation != nil else { return }
      withAnimation(.easeInOut(duration: 0.15)) {
        if isOpen { expanded.remove(card.id) } else { expanded.insert(card.id) }
      }
      if !isOpen, expansions[card.id] == nil, !expanding.contains(card.id) {
        Task { await loadExpansion(card.id) }
      }
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
        if DemoMode.opensChart { chartSeries = DemoMode.read.series?["hrv"] }
      }
      return
    }
    #endif
    guard let url = URL(string: "\(apiBase)/api/read") else { return }
    await MainActor.run { isLoading = true; errorText = nil }

    // HealthKit is on-device: read a summary and send it up so the backend can
    // fill Sleep + Recovery when Oura isn't connected.
    // The local date lets the read find today's session in the athlete's plan
    // and the plan engine evaluate the athlete's tomorrow, not the server's.
    var payload: [String: Any] = ["athleteId": tokenManager.athleteId, "today": PlanDay.today()]
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
        let msg = String(data: data, encoding: .utf8) ?? "Unknown error"
        await MainActor.run { errorText = msg; isLoading = false }
        return
      }
      let decoded = try JSONDecoder().decode(ReadResponse.self, from: data)
      await MainActor.run {
        read = decoded.read
        cards = decoded.cards
        expansions = [:] // a new read means new numbers to interpret
        readGeneration += 1
        isLoading = false
      }
    } catch {
      await MainActor.run { errorText = error.localizedDescription; isLoading = false }
    }
  }
}
