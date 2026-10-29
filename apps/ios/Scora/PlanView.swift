import SwiftUI

// MARK: - Models

// One scheduled session, from GET /api/plan (stored rows) or
// POST /api/plan/manual (freshly parsed rows). Both shapes decode here.
struct PlanWorkout: Decodable, Identifiable, Equatable {
  let date: String // YYYY-MM-DD
  let type: String
  let intensity: String?
  let durationMin: Int?
  let distanceKm: Double?
  let description: String?
  // The session's steps on a SCORA plan, for Send to Watch. Nil for pasted
  // and imported plans.
  var steps: [PlanStep]? = nil
  // The stored row's id (GET /api/plan); freshly parsed rows have none.
  var rowId: String? = nil

  var id: String { rowId ?? "\(date)|\(type)|\(description ?? "")" }

  enum CodingKeys: String, CodingKey {
    case date, type, intensity, description
    case durationMin = "duration_min", distanceKm = "distance_km"
    case scheduledDate = "scheduled_date", plannedType = "planned_type"
    case plannedIntensity = "planned_intensity", plannedDuration = "planned_duration_min"
    case plannedDistance = "planned_distance_km", plannedDescription = "planned_description"
    case structure = "workout_structure_json"
    case rowId = "id"
  }

  init(date: String, type: String, intensity: String?, durationMin: Int?, distanceKm: Double?, description: String?) {
    self.date = date; self.type = type; self.intensity = intensity
    self.durationMin = durationMin; self.distanceKm = distanceKm; self.description = description
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    date = try c.decodeIfPresent(String.self, forKey: .date) ?? c.decode(String.self, forKey: .scheduledDate)
    type = try c.decodeIfPresent(String.self, forKey: .type) ?? c.decode(String.self, forKey: .plannedType)
    intensity = try c.decodeIfPresent(String.self, forKey: .intensity) ?? c.decodeIfPresent(String.self, forKey: .plannedIntensity)
    durationMin = try c.decodeIfPresent(Int.self, forKey: .durationMin) ?? c.decodeIfPresent(Int.self, forKey: .plannedDuration)
    distanceKm = try c.decodeIfPresent(Double.self, forKey: .distanceKm) ?? c.decodeIfPresent(Double.self, forKey: .plannedDistance)
    description = try c.decodeIfPresent(String.self, forKey: .description) ?? c.decodeIfPresent(String.self, forKey: .plannedDescription)
    // A structure the app cannot read only hides Send to Watch.
    steps = try? c.decodeIfPresent([PlanStep].self, forKey: .structure)
    rowId = try? c.decodeIfPresent(String.self, forKey: .rowId)
  }

  // "Tue Oct 20", from the plan date as written (no time zone shift).
  var dayLabel: String {
    let parse = DateFormatter()
    parse.locale = Locale(identifier: "en_US_POSIX")
    parse.timeZone = TimeZone(identifier: "UTC")
    parse.dateFormat = "yyyy-MM-dd"
    guard let d = parse.date(from: date) else { return date }
    let out = DateFormatter()
    out.timeZone = TimeZone(identifier: "UTC")
    out.dateFormat = "EEE MMM d"
    return out.string(from: d)
  }

  // "tempo · 45 min · 8 km": the parsed values, nothing added.
  var detail: String {
    var parts: [String] = []
    if let intensity { parts.append(intensity) } else { parts.append(type) }
    if let durationMin { parts.append("\(durationMin) min") }
    if let distanceKm {
      parts.append(distanceKm.rounded() == distanceKm ? "\(Int(distanceKm)) km" : String(format: "%.1f km", distanceKm))
    }
    return parts.joined(separator: " · ")
  }
}

struct PlanListResponse: Decodable {
  let workouts: [PlanWorkout]
  // The last 7 days' sessions not yet marked done or missed.
  var recent: [PlanWorkout]? = nil
}

struct PlanSaveResponse: Decodable {
  let workouts: [PlanWorkout]
  let rejected: [String]
}

struct PlanErrorResponse: Decodable {
  let error: String
}

// One named change the plan engine made, from GET /api/plan/adaptations.
// The reason is the server's sentence; the app adds nothing to it.
struct PlanAdaptation: Decodable, Identifiable, Equatable {
  let id: String
  let type: String
  let reason: String
  let triggeredAt: String
  // Only on the history endpoint: the athlete hid it from the short list.
  var dismissed: Bool? = nil

  enum CodingKeys: String, CodingKey {
    case id, type = "adaptation_type", reason = "reason_text", triggeredAt = "triggered_at", dismissed
  }
}

struct PlanAdaptationsResponse: Decodable {
  let adaptations: [PlanAdaptation]
}

enum PlanChanges {
  // Newest first, at most three: the list is a footnote to the plan, not a feed.
  // A displaced session's "skipped" row repeats its move, so it is left out.
  static func visible(_ rows: [PlanAdaptation]) -> [PlanAdaptation] {
    Array(rows.filter { $0.type != "skipped" }.sorted { $0.triggeredAt > $1.triggeredAt }.prefix(3))
  }

  static func dismissing(_ id: String, from rows: [PlanAdaptation]) -> [PlanAdaptation] {
    rows.filter { $0.id != id }
  }

  // The full history (PRD §5.B.1): every row, newest first, displaced ones too.
  static func history(_ rows: [PlanAdaptation]) -> [PlanAdaptation] {
    rows.sorted { $0.triggeredAt > $1.triggeredAt }
  }

  // What happened, in a word, beside the server's reason.
  static func label(_ type: String) -> String {
    switch type {
    case "moved": return "Moved"
    case "downgraded": return "Changed"
    case "skipped": return "Made a rest day"
    case "frozen_race_week": return "Race week"
    default: return "Changed"
    }
  }

  // "2026-10-28T06:00:00.000Z" -> "Oct 28" (UTC day the engine made it).
  static func day(_ triggeredAt: String) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd"
    guard let d = f.date(from: String(triggeredAt.prefix(10))) else { return String(triggeredAt.prefix(10)) }
    f.dateFormat = "MMM d"
    return f.string(from: d)
  }
}

// Every change the plan engine made, from GET /api/plan/adaptations/history.
struct PlanHistoryView: View {
  let rows: [PlanAdaptation]
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 10) {
          if rows.isEmpty {
            Text("No plan changes yet.").font(.subheadline).foregroundColor(.gray).padding(.top, 24)
          }
          ForEach(rows) { c in
            VStack(alignment: .leading, spacing: 4) {
              HStack {
                Text(PlanChanges.label(c.type)).font(.caption.bold()).foregroundColor(.orange)
                Text(PlanChanges.day(c.triggeredAt)).font(.caption).foregroundColor(.gray)
                Spacer()
                if c.dismissed == true { Text("Dismissed").font(.caption2).foregroundColor(.gray) }
              }
              Text(c.reason).font(.footnote).foregroundColor(Color(white: 0.8))
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(12)
            .background(Color(white: 0.08))
            .cornerRadius(10)
          }
        }
        .padding()
      }
      .background(Color.black)
      .navigationTitle("Plan changes")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .preferredColorScheme(.dark)
  }
}

// Race prediction from GET /api/plan/prediction (PRD §5.B.6). Always a range.
struct RacePrediction: Decodable, Equatable {
  let ok: Bool
  let race: String
  let lowS: Int?
  let highS: Int?
  let efforts: [Effort]?
  let usedRaces: Bool?
  let needed: String?

  struct Effort: Decodable, Equatable {
    let date: String
  }

  enum CodingKeys: String, CodingKey {
    case ok, race, efforts, needed
    case lowS = "low_s", highS = "high_s", usedRaces = "used_races"
  }

  // m:ss under an hour; h:mm otherwise. In h:mm the fast end rounds down
  // and the slow end up, so the shown range always contains the computed one.
  static func duration(_ s: Int, hours: Bool? = nil, roundUp: Bool = false) -> String {
    if hours ?? (s >= 3600) {
      let mins = roundUp ? (s + 59) / 60 : s / 60
      return "\(mins / 60):\(String(format: "%02d", mins % 60))"
    }
    return "\(s / 60):\(String(format: "%02d", s % 60))"
  }

  // "1:45 – 1:52": both ends in one format, chosen by the slow end.
  var headline: String? {
    guard ok, let lowS, let highS else { return nil }
    let hours = highS >= 3600
    return "\(Self.duration(lowS, hours: hours)) – \(Self.duration(highS, hours: hours, roundUp: true))"
  }

  var basis: String {
    if !ok { return needed.map { "No estimate yet: needs \($0)." } ?? "No estimate yet." }
    let n = efforts?.count ?? 0
    let what = usedRaces == true ? (n == 1 ? "your recent race" : "your recent races") : "your \(n) best runs of the last 8 weeks"
    return "Based on \(what)."
  }
}

struct PredictionResponse: Decodable {
  let prediction: RacePrediction
}

enum PlanDay {
  // Today in the athlete's own zone, so "Tue" resolves to their Tuesday.
  static func today(_ now: Date = Date(), zone: TimeZone = .current) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = zone
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: now)
  }

  // Sessions from today on, first 14, for the list after a save.
  static func upcoming(_ rows: [PlanWorkout], today: String) -> [PlanWorkout] {
    Array(rows.filter { $0.date >= today }.sorted { $0.date < $1.date }.prefix(14))
  }

  static func skippedNote(_ count: Int, unit: String = "line") -> String? {
    guard count > 0 else { return nil }
    return count == 1
      ? "1 \(unit) could not be read and was left out."
      : "\(count) \(unit)s could not be read and were left out."
  }
}

// A plan app's calendar link. The phone fetches the feed and sends its text
// to POST /api/plan/ical; the link itself never leaves the device.
enum CalendarFeed {
  static let maxBytes = 1_000_000

  // webcal:// and https:// links; anything else (http, file, data) is refused.
  static func normalizedURL(_ raw: String) -> URL? {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.lowercased().hasPrefix("webcal://") { s = "https://" + s.dropFirst("webcal://".count) }
    guard let url = URL(string: s), url.scheme?.lowercased() == "https", let host = url.host, !host.isEmpty else { return nil }
    return url
  }

  // The imported link stays on the phone, per athlete, so the plan can be
  // re-imported when Your Plan opens. A pasted plan or a sign-out clears it.
  static let refreshEvery: TimeInterval = 12 * 3600
  private static func linkKey(_ athleteId: String) -> String { "scora.calendarFeedLink.\(athleteId)" }
  private static func refreshedKey(_ athleteId: String) -> String { "scora.calendarFeedRefreshedAt.\(athleteId)" }

  static func needsRefresh(link: String?, lastRefresh: Date?, now: Date = Date()) -> Bool {
    guard let link, normalizedURL(link) != nil else { return false }
    guard let lastRefresh else { return true }
    return now.timeIntervalSince(lastRefresh) >= refreshEvery
  }

  static func savedLink(for athleteId: String) -> String? {
    UserDefaults.standard.string(forKey: linkKey(athleteId))
  }

  static func save(_ link: String?, for athleteId: String) {
    UserDefaults.standard.set(link, forKey: linkKey(athleteId))
    UserDefaults.standard.set(link == nil ? nil : Date(), forKey: refreshedKey(athleteId))
  }

  // Also after a failed attempt, so a dead link is tried every 12 hours, not on every open.
  static func markTried(for athleteId: String, at date: Date = Date()) {
    UserDefaults.standard.set(date, forKey: refreshedKey(athleteId))
  }

  static func lastRefresh(for athleteId: String) -> Date? {
    UserDefaults.standard.object(forKey: refreshedKey(athleteId)) as? Date
  }

  // The feed text, if it looks like a calendar and is not too large.
  static func calendarText(_ data: Data) -> String? {
    guard data.count <= maxBytes, let text = String(data: data, encoding: .utf8),
          text.range(of: "BEGIN:VCALENDAR", options: .caseInsensitive) != nil else { return nil }
    return text
  }
}

// MARK: - Plan setup (doc 09 §2.3)

// One goal the loaded templates cover, from GET /api/plan/options, with
// what each experience level's templates take.
struct PlanLevel: Decodable, Equatable {
  let level: String
  let weeklyKm: [Double] // [min, max): the max itself does not match
  let minWeeks: Int

  enum CodingKeys: String, CodingKey { case level, weeklyKm = "weekly_km", minWeeks = "min_weeks" }

  // Whole km the form may offer.
  var kmRange: ClosedRange<Int> {
    let lo = Int((weeklyKm.first ?? 0).rounded(.up))
    let hi = Int((weeklyKm.last ?? 0).rounded(.up)) - 1
    return lo...max(lo, hi)
  }
}

struct PlanGoal: Decodable, Identifiable, Equatable {
  let sport: String
  let goalType: String
  let label: String
  let levels: [PlanLevel]
  var id: String { "\(sport)|\(goalType)" }

  enum CodingKeys: String, CodingKey {
    case sport, goalType = "goal_type", label, levels
  }
}

struct PlanOptionsResponse: Decodable {
  let goals: [PlanGoal]
}

enum PlanSetup {
  // Doc 09 §2.3: a race at least 4 weeks out, and never closer than the
  // shortest plan for that level (generation refuses a plan that would have
  // started before this week).
  static let minWeeksAhead = 4

  static func earliestRace(from now: Date = Date(), minWeeks: Int = 0, calendar: Calendar = .current) -> Date {
    calendar.date(byAdding: .day, value: 7 * max(minWeeksAhead, minWeeks), to: calendar.startOfDay(for: now))!
  }

  static func clamp(_ km: Int, to range: ClosedRange<Int>) -> Int { min(max(km, range.lowerBound), range.upperBound) }

  // Short name for the picker; levelText is the full line under it.
  static func levelName(_ level: String) -> String {
    switch level {
    case "first_timer": return "First timer"
    case "regular": return "Regular racer"
    case "competitive": return "Competitive racer"
    default: return level.replacingOccurrences(of: "_", with: " ").capitalized
    }
  }

  static func levelText(_ level: String) -> String {
    switch level {
    case "first_timer": return "First timer or first serious block"
    case "regular": return "Regular racer"
    case "competitive": return "Competitive racer"
    default: return level.replacingOccurrences(of: "_", with: " ").capitalized
    }
  }

  static func body(athleteId: String, goal: PlanGoal, raceDate: Date, weeklyKm: Int, level: String, now: Date = Date()) -> [String: Any] {
    [
      "athleteId": athleteId, "today": PlanDay.today(now),
      "sport": goal.sport, "goal_type": goal.goalType, "experience_level": level,
      "current_weekly_km": weeklyKm, "goal_race_date": PlanDay.today(raceDate),
    ]
  }
}

struct PlanSetupView: View {
  let goals: [PlanGoal]
  let athleteId: String
  let apiBase: String
  let replacesPlan: Bool // the athlete already has a plan; building replaces it
  var onBuilt: () -> Void
  @Environment(\.dismiss) private var dismiss

  @State private var goalId: String
  @State private var level: String
  @State private var raceDate: Date
  @State private var weeklyKm: Int
  @State private var isBuilding = false
  @State private var confirming = false
  @State private var message: String?

  init(goals: [PlanGoal], athleteId: String, apiBase: String, replacesPlan: Bool, onBuilt: @escaping () -> Void) {
    self.goals = goals
    self.athleteId = athleteId
    self.apiBase = apiBase
    self.replacesPlan = replacesPlan
    self.onBuilt = onBuilt
    let first = goals.first?.levels.first
    _goalId = State(initialValue: goals.first?.id ?? "")
    _level = State(initialValue: first?.level ?? "")
    _raceDate = State(initialValue: PlanSetup.earliestRace(minWeeks: first?.minWeeks ?? 0))
    _weeklyKm = State(initialValue: first.map { PlanSetup.clamp(30, to: $0.kmRange) } ?? 30)
  }

  private var goal: PlanGoal? { goals.first { $0.id == goalId } ?? goals.first }
  private var levelInfo: PlanLevel? { goal?.levels.first { $0.level == level } }

  var body: some View {
    NavigationStack {
      Form {
        Section("Goal race") {
          Picker("Race", selection: $goalId) {
            ForEach(goals) { g in Text(g.label).tag(g.id) }
          }
          DatePicker("Race date", selection: $raceDate, in: PlanSetup.earliestRace(minWeeks: levelInfo?.minWeeks ?? 0)..., displayedComponents: .date)
        }
        Section("Where you are now") {
          Picker("Experience", selection: $level) {
            ForEach(goal?.levels ?? [], id: \.level) { l in Text(PlanSetup.levelName(l.level)).tag(l.level) }
          }
          if !level.isEmpty {
            Text(PlanSetup.levelText(level)).font(.footnote).foregroundColor(.gray)
          }
          if let range = levelInfo?.kmRange {
            Stepper("\(weeklyKm) km a week", value: $weeklyKm, in: range)
          }
        }
        Section {
          Button(isBuilding ? "Building…" : "Build my plan") {
            if replacesPlan { confirming = true } else { Task { await build() } }
          }
          .disabled(isBuilding || goal == nil || levelInfo == nil)
          if let message { Text(message).font(.footnote).foregroundColor(.gray) }
        } footer: {
          Text("Plans come from coach-reviewed templates, scaled to your current volume.")
        }
      }
      .navigationTitle("Build a plan")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .onChange(of: goalId) {
        if let g = goal, !g.levels.contains(where: { $0.level == level }) { level = g.levels.first?.level ?? "" }
        fitToLevel()
      }
      .onChange(of: level) { fitToLevel() }
      .confirmationDialog("This replaces your current plan. Its sessions stay on record.", isPresented: $confirming, titleVisibility: .visible) {
        Button("Build my plan") { Task { await build() } }
        Button("Cancel", role: .cancel) {}
      }
    }
    .interactiveDismissDisabled(isBuilding)
    .tint(.orange)
    .preferredColorScheme(.dark)
  }

  // Keep the km and the race date inside what the chosen level's templates take.
  private func fitToLevel() {
    guard let info = levelInfo else { return }
    weeklyKm = PlanSetup.clamp(weeklyKm, to: info.kmRange)
    raceDate = max(raceDate, PlanSetup.earliestRace(minWeeks: info.minWeeks))
  }

  private func build() async {
    guard let goal, let url = URL(string: "\(apiBase)/api/plan/generate") else { return }
    await MainActor.run { isBuilding = true; message = nil }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: PlanSetup.body(
      athleteId: athleteId, goal: goal, raceDate: raceDate, weeklyKm: weeklyKm, level: level))
    let result = try? await URLSession.shared.data(for: req)
    let status = (result?.1 as? HTTPURLResponse)?.statusCode ?? 0
    // The server's own sentence on a refusal (no template yet, race too soon).
    let error = result.flatMap { try? JSONDecoder().decode(CDVError.self, from: $0.0) }?.error
    await MainActor.run {
      isBuilding = false
      if status == 200 {
        onBuilt()
        dismiss()
      } else {
        message = error ?? "Building the plan failed. Try again in a moment."
      }
    }
  }
}

// MARK: - Plan block (PRD §5.B.1)

// The active SCORA plan as a whole, from GET /api/plan/block.
struct PlanBlock: Decodable, Equatable {
  struct Phase: Decodable, Equatable {
    let name: String
    let firstWeek: Int
    let lastWeek: Int
    let focus: String
    let current: Bool
    enum CodingKeys: String, CodingKey { case name, firstWeek = "first_week", lastWeek = "last_week", focus, current }
  }
  let goal: String
  let week: Int
  let weeks: Int
  let raceDate: String?
  let phases: [Phase]
  enum CodingKeys: String, CodingKey { case goal, week, weeks, raceDate = "race_date", phases }

  // "Week 4 of 12 · Base"
  var headline: String {
    let phase = phases.first(where: \.current).map { " · \($0.name)" } ?? ""
    return "Week \(week) of \(weeks)\(phase)"
  }

  // "Half marathon, Dec 27"
  var raceLine: String? {
    guard let raceDate else { return nil }
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd"
    guard let d = f.date(from: raceDate) else { return goal }
    f.dateFormat = "MMM d"
    return "\(goal), \(f.string(from: d))"
  }
}

struct PlanBlockResponse: Decodable {
  let block: PlanBlock?
}

struct PlanBlockView: View {
  let block: PlanBlock

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(block.headline).font(.subheadline.bold()).foregroundColor(.white)
        Spacer()
        if let race = block.raceLine { Text(race).font(.caption).foregroundColor(.gray) }
      }
      // One segment per phase, as wide as its weeks, its name under it; this
      // week's phase in orange.
      GeometryReader { geo in
        HStack(alignment: .top, spacing: 3) {
          ForEach(block.phases, id: \.name) { p in
            let span = CGFloat(p.lastWeek - p.firstWeek + 1)
            VStack(alignment: .leading, spacing: 6) {
              RoundedRectangle(cornerRadius: 3)
                .fill(p.current ? Color.orange : Color(white: 0.22))
                .frame(height: 6)
              Text(p.name).font(.caption2).foregroundColor(p.current ? .orange : .gray).lineLimit(1)
            }
            .frame(width: max(4, (geo.size.width - 3 * CGFloat(block.phases.count - 1)) * span / CGFloat(max(block.weeks, 1))))
          }
        }
      }
      .frame(height: 26)
      if let focus = block.phases.first(where: \.current)?.focus, !focus.isEmpty {
        Text(focus.prefix(1).uppercased() + focus.dropFirst()).font(.footnote).foregroundColor(Color(white: 0.7))
      }
    }
    .padding(12)
    .background(Color(white: 0.08))
    .cornerRadius(10)
  }
}

// MARK: - View

struct PlanView: View {
  @ObservedObject var tokenManager: TokenManager
  @Environment(\.dismiss) private var dismiss

  @State private var text = ""
  @State private var workouts: [PlanWorkout] = []
  @State private var unmarked: [PlanWorkout] = []
  @State private var changes: [PlanAdaptation] = []
  @State private var changesOn = false // the adaptations endpoint answered
  @State private var history: [PlanAdaptation] = []
  @State private var showHistory = false
  @State private var prediction: RacePrediction?
  @State private var note: String?
  @State private var errorText: String?
  @State private var isSaving = false
  @State private var isEditing = false
  @State private var watchNote: String?
  @State private var sendingId: String?
  @State private var feedLink = ""
  @State private var isImporting = false
  @State private var savedFeed: String?
  @State private var refreshTask: Task<Void, Never>?
  @State private var planGoals: [PlanGoal] = [] // empty: generation is off or no templates
  @State private var block: PlanBlock?
  @State private var showSetup = false

  private let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Your Plan").font(.headline.bold()).foregroundColor(.white)
        Spacer()
        Button("Done") { dismiss() }.foregroundColor(.orange)
      }
      .padding()

      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if workouts.isEmpty || isEditing {
            pasteSection
          } else {
            upcomingSection
          }
          if let errorText {
            Text(errorText).font(.footnote).foregroundColor(.gray)
          }
          if !planGoals.isEmpty && !isEditing {
            Button("Build a SCORA plan") { showSetup = true }
              .font(.subheadline).foregroundColor(.orange)
          }
        }
        .padding()
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
    .task {
      await loadPlan()
      let id = tokenManager.athleteId
      let link = CalendarFeed.savedLink(for: id)
      await MainActor.run { savedFeed = link }
      if let link, CalendarFeed.needsRefresh(link: link, lastRefresh: CalendarFeed.lastRefresh(for: id)) {
        let task = Task { await importFeed(link: link, refresh: true, silent: true) }
        await MainActor.run { refreshTask = task }
        await task.value
      }
    }
    .task { await loadPrediction() } // independent: shown even if the plan list fails
    .task { await loadOptions() }
    .task { await loadBlock() }
    .sheet(isPresented: $showSetup) {
      PlanSetupView(goals: planGoals, athleteId: tokenManager.athleteId, apiBase: apiBase, replacesPlan: !workouts.isEmpty) {
        Task { await loadPlan(); await loadBlock() }
        NotificationCenter.default.post(name: Notification.Name("planChanged"), object: nil)
      }
    }
  }

  // The active SCORA plan's block. Off (404) unless plan generation is on.
  private func loadBlock() async {
    #if DEBUG
    if let demo = DemoMode.planBlock { await MainActor.run { block = demo }; return }
    #endif
    var comps = URLComponents(string: "\(apiBase)/api/plan/block")
    comps?.queryItems = [URLQueryItem(name: "athleteId", value: tokenManager.athleteId), URLQueryItem(name: "today", value: PlanDay.today())]
    guard let url = comps?.url,
          let (data, resp) = try? await URLSession.shared.data(from: url),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(PlanBlockResponse.self, from: data)
    else { return }
    await MainActor.run { block = decoded.block }
  }

  // Off (404) unless plan generation is on; then the goals the templates cover.
  private func loadOptions() async {
    #if DEBUG
    if let demo = DemoMode.planGoals { await MainActor.run { planGoals = demo; showSetup = true }; return }
    #endif
    var comps = URLComponents(string: "\(apiBase)/api/plan/options")
    comps?.queryItems = [URLQueryItem(name: "athleteId", value: tokenManager.athleteId)]
    guard let url = comps?.url,
          let (data, resp) = try? await URLSession.shared.data(from: url),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(PlanOptionsResponse.self, from: data)
    else { return }
    await MainActor.run { planGoals = decoded.goals }
  }

  private var pasteSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Have a training plan?")
        .font(.system(size: 22, weight: .regular, design: .serif))
        .foregroundColor(.white)
      Text("Paste your plan and SCORA reads it alongside your body. One session per line with a day or date works best.")
        .font(.subheadline)
        .foregroundColor(.gray)
      TextEditor(text: $text)
        .scrollContentBackground(.hidden)
        .frame(minHeight: 180)
        .padding(8)
        .background(Color(white: 0.11))
        .cornerRadius(10)
        .foregroundColor(.white)
        .overlay(alignment: .topLeading) {
          if text.isEmpty {
            Text("Paste plan here...").foregroundColor(Color(white: 0.4)).padding(14).allowsHitTesting(false)
          }
        }
      HStack {
        Button(action: { Task { await savePlan() } }) {
          HStack(spacing: 8) {
            if isSaving { ProgressView().tint(.black) }
            Text("Save plan").bold()
          }
          .padding(.horizontal, 18).padding(.vertical, 10)
          .background(Color.orange).foregroundColor(.black).cornerRadius(8)
        }
        .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        if isEditing {
          Button("Cancel") { isEditing = false }.foregroundColor(.gray).padding(.leading, 8)
        }
      }
      Text("Or import a calendar link")
        .font(.subheadline.bold())
        .foregroundColor(.white)
        .padding(.top, 12)
      Text("If your plan app shares your plan as a calendar (a webcal or https link), paste the link here.")
        .font(.footnote)
        .foregroundColor(.gray)
      HStack(spacing: 8) {
        TextField("webcal://...", text: $feedLink)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          .padding(10)
          .background(Color(white: 0.11))
          .cornerRadius(8)
          .foregroundColor(.white)
        Button(action: { Task { await importFeed(link: feedLink, refresh: false, silent: false) } }) {
          HStack(spacing: 8) {
            if isImporting { ProgressView().tint(.black) }
            Text("Import").bold()
          }
          .padding(.horizontal, 14).padding(.vertical, 10)
          .background(Color.orange).foregroundColor(.black).cornerRadius(8)
        }
        .disabled(isImporting || CalendarFeed.normalizedURL(feedLink) == nil)
      }
    }
  }

  private var upcomingSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let block { PlanBlockView(block: block) }
      if !changes.isEmpty {
        Text("Plan changes").font(.caption.bold()).foregroundColor(.gray).textCase(.uppercase).padding(.top, 4)
        ForEach(changes) { c in
          HStack(alignment: .top, spacing: 8) {
            Text(c.reason)
              .font(.footnote)
              .foregroundColor(Color(white: 0.8))
              .frame(maxWidth: .infinity, alignment: .leading)
            // Acknowledge: the change stays in the plan, it leaves this list.
            Button(action: { Task { await dismissChange(c) } }) {
              Image(systemName: "xmark").font(.caption2.bold()).foregroundColor(.gray)
            }
            .accessibilityLabel("Dismiss this plan change")
          }
          .padding(12)
          .background(Color(white: 0.08))
          .cornerRadius(10)
        }
      }
      if changesOn {
        Button("All plan changes") {
          Task {
            let loaded = await loadHistory()
            await MainActor.run {
              if loaded { showHistory = true } else { note = "Plan changes did not load. Try again in a moment." }
            }
          }
        }
          .font(.footnote).foregroundColor(.orange)
          .sheet(isPresented: $showHistory) { PlanHistoryView(rows: history) }
      }
      if let prediction {
        VStack(alignment: .leading, spacing: 4) {
          Text("Race estimate").font(.caption.bold()).foregroundColor(.gray).textCase(.uppercase)
          if let h = prediction.headline {
            Text(h).font(.system(size: 22, weight: .regular, design: .serif)).foregroundColor(.white)
          }
          Text(prediction.basis).font(.footnote).foregroundColor(.gray)
        }
        .padding(.bottom, 4)
      }
      if unmarked.contains(where: { $0.rowId != nil }) {
        Text("Past sessions").font(.caption.bold()).foregroundColor(.gray).textCase(.uppercase)
        ForEach(unmarked.filter { $0.rowId != nil }) { w in
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(w.dayLabel).font(.subheadline.bold()).foregroundColor(.white)
              Text(w.detail).font(.caption).foregroundColor(.gray)
            }
            Spacer()
            // A miss is recorded, never rescheduled (CLAUDE.md §6.2).
            Button("Completed") { Task { await mark(w, done: true) } }
              .font(.caption.bold()).foregroundColor(.orange)
            Button("Missed") { Task { await mark(w, done: false) } }
              .font(.caption.bold()).foregroundColor(.gray).padding(.leading, 10)
          }
          .padding(12)
          .background(Color(white: 0.08))
          .cornerRadius(10)
        }
      }
      Text("Coming up").font(.caption.bold()).foregroundColor(.gray).textCase(.uppercase)
      if let note { Text(note).font(.footnote).foregroundColor(.gray) }
      if let watchNote { Text(watchNote).font(.footnote).foregroundColor(.gray) }
      ForEach(workouts) { w in
        VStack(alignment: .leading, spacing: 3) {
          HStack {
            Text(w.dayLabel).font(.subheadline.bold()).foregroundColor(.white)
            Spacer()
            Text(w.detail).font(.caption).foregroundColor(.orange)
          }
          if let d = w.description, !d.isEmpty {
            Text(d).font(.footnote).foregroundColor(Color(white: 0.7))
          }
          if WatchSend.canSend(type: w.type, steps: w.steps, date: w.date, today: PlanDay.today()) {
            Button(action: { Task { await sendToWatch(w) } }) {
              HStack(spacing: 6) {
                if sendingId == w.id { ProgressView().tint(.orange) }
                Text("Send to Watch")
              }
            }
            .font(.caption.bold()).foregroundColor(.orange).padding(.top, 2)
            .disabled(sendingId != nil)
          }
        }
        .padding(12)
        .background(Color(white: 0.11))
        .cornerRadius(10)
      }
      if let link = savedFeed {
        Button(action: { Task { await importFeed(link: link, refresh: true, silent: false) } }) {
          HStack(spacing: 6) {
            if isImporting { ProgressView().tint(.orange) }
            Text("Refresh from your calendar")
          }
        }
        .font(.subheadline).foregroundColor(.orange).padding(.top, 4)
        .disabled(isImporting)
      }
      Button("Paste or import a new plan") { refreshTask?.cancel(); isEditing = true; text = "" }
        .font(.subheadline).foregroundColor(.orange).padding(.top, 4)
    }
  }

  // MARK: Watch

  private func sendToWatch(_ w: PlanWorkout) async {
    guard let steps = w.steps else { return }
    await MainActor.run { sendingId = w.id; watchNote = nil }
    let outcome = await WatchSend.send(
      steps: steps, type: w.type, date: w.date, displayName: w.detail, dayLabel: w.dayLabel,
      scheduler: AppleWatchScheduler()
    )
    await MainActor.run { watchNote = WatchSend.message(outcome); sendingId = nil }
    if case .sent = outcome { await recordWatchSend(w) }
  }

  // Tells the API the session is on the Watch (doc 10 3.1.9). Best effort: a
  // failure only leaves the share uncounted.
  private func recordWatchSend(_ w: PlanWorkout) async {
    guard let rowId = w.rowId, let url = URL(string: "\(apiBase)/api/plan/workouts/\(rowId)/watch-sent") else { return }
    #if DEBUG
    if DemoMode.planSessions != nil { return }
    #endif
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["athleteId": tokenManager.athleteId])
    _ = try? await URLSession.shared.data(for: req)
  }

  // MARK: Networking

  private func mark(_ w: PlanWorkout, done: Bool) async {
    guard let rowId = w.rowId, let url = URL(string: "\(apiBase)/api/plan/workouts/\(rowId)/status") else { return }
    #if DEBUG
    if DemoMode.planSessions != nil { await MainActor.run { unmarked.removeAll { $0.id == w.id } }; return }
    #endif
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "athleteId": tokenManager.athleteId, "status": done ? "done" : "missed", "today": PlanDay.today(),
    ])
    guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return }
    let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
    // 404: marked elsewhere or no longer on the plan; either way it leaves the list.
    if status == 200 || status == 404 {
      await MainActor.run { unmarked.removeAll { $0.id == w.id } }
    }
  }

  private func loadPlan() async {
    #if DEBUG
    if let demo = DemoMode.planSessions {
      var past = PlanWorkout(date: PlanDay.today(Date().addingTimeInterval(-2 * 86_400)), type: "run", intensity: "tempo", durationMin: 45, distanceKm: nil, description: nil)
      past.rowId = "demo-past"
      await MainActor.run { workouts = demo; unmarked = [past] }
      return
    }
    #endif
    let today = PlanDay.today()
    var comps = URLComponents(string: "\(apiBase)/api/plan")
    comps?.queryItems = [URLQueryItem(name: "athleteId", value: tokenManager.athleteId), URLQueryItem(name: "today", value: today)]
    guard let url = comps?.url,
          let (data, resp) = try? await URLSession.shared.data(from: url),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(PlanListResponse.self, from: data)
    else { return }
    await MainActor.run { workouts = decoded.workouts; unmarked = decoded.recent ?? [] }
    await loadChanges()
  }

  // Named plan changes. The endpoint is off (404) until plan adaptations are
  // switched on; then the list simply stays empty.
  private func loadChanges() async {
    var comps = URLComponents(string: "\(apiBase)/api/plan/adaptations")
    comps?.queryItems = [URLQueryItem(name: "athleteId", value: tokenManager.athleteId)]
    guard let url = comps?.url,
          let (data, resp) = try? await URLSession.shared.data(from: url),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(PlanAdaptationsResponse.self, from: data)
    else { return }
    await MainActor.run { changes = PlanChanges.visible(decoded.adaptations); changesOn = true }
  }

  // True once the history arrived; a failed load must not read as "no changes".
  private func loadHistory() async -> Bool {
    var comps = URLComponents(string: "\(apiBase)/api/plan/adaptations/history")
    comps?.queryItems = [URLQueryItem(name: "athleteId", value: tokenManager.athleteId)]
    guard let url = comps?.url,
          let (data, resp) = try? await URLSession.shared.data(from: url),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(PlanAdaptationsResponse.self, from: data)
    else { return false }
    await MainActor.run { history = PlanChanges.history(decoded.adaptations) }
    return true
  }

  private func dismissChange(_ c: PlanAdaptation) async {
    guard let url = URL(string: "\(apiBase)/api/plan/adaptations/\(c.id)/dismiss") else { return }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["athleteId": tokenManager.athleteId])
    guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return }
    let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
    // 404: already dismissed (another device) or gone; either way it leaves the list.
    if status == 200 || status == 404 {
      await MainActor.run { changes = PlanChanges.dismissing(c.id, from: changes) }
      await loadChanges() // the list shows three; refill from the server
    }
  }

  // Off (404) until predictions are switched on; then shown above the plan.
  private func loadPrediction() async {
    var comps = URLComponents(string: "\(apiBase)/api/plan/prediction")
    comps?.queryItems = [URLQueryItem(name: "athleteId", value: tokenManager.athleteId), URLQueryItem(name: "today", value: PlanDay.today())]
    guard let url = comps?.url,
          let (data, resp) = try? await URLSession.shared.data(from: url),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(PredictionResponse.self, from: data)
    else { return }
    await MainActor.run { prediction = decoded.prediction }
  }

  private func savePlan() async {
    guard let url = URL(string: "\(apiBase)/api/plan/manual") else { return }
    await MainActor.run { refreshTask?.cancel(); isSaving = true; errorText = nil }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "athleteId": tokenManager.athleteId, "text": text, "today": PlanDay.today(),
    ])
    do {
      let (data, resp) = try await URLSession.shared.data(for: req)
      let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
      if status == 200, let saved = try? JSONDecoder().decode(PlanSaveResponse.self, from: data) {
        // Show what was saved, even when the plan starts weeks from now.
        await MainActor.run {
          workouts = PlanDay.upcoming(saved.workouts, today: PlanDay.today())
          note = PlanDay.skippedNote(saved.rejected.count)
          isEditing = false
          isSaving = false
          CalendarFeed.save(nil, for: tokenManager.athleteId) // the paste replaced the calendar import
          savedFeed = nil
        }
        NotificationCenter.default.post(name: Notification.Name("planChanged"), object: nil)
      } else {
        let msg = (try? JSONDecoder().decode(PlanErrorResponse.self, from: data))?.error ?? "Saving the plan failed."
        await MainActor.run { errorText = msg; isSaving = false }
      }
    } catch {
      await MainActor.run { errorText = error.localizedDescription; isSaving = false }
    }
  }

  // Fetches the feed on the phone, then sends its text. The endpoint is off
  // (404) until calendar import is switched on. `refresh` asks the server to
  // replace the plan only if it still comes from this calendar, so a refresh
  // never overwrites a plan pasted since. A silent refresh (on open) shows no
  // error, never closes the editor, and stops if editing or a paste begins.
  private func importFeed(link: String, refresh: Bool, silent: Bool) async {
    guard let feed = CalendarFeed.normalizedURL(link), let url = URL(string: "\(apiBase)/api/plan/ical") else { return }
    let athleteId = tokenManager.athleteId
    if silent { CalendarFeed.markTried(for: athleteId) }
    await MainActor.run { isImporting = true; if !silent { errorText = nil } }
    let fail = { (msg: String) async in await MainActor.run { if !silent { errorText = msg }; isImporting = false } }
    // A silent refresh goes ahead only while nothing else is changing the plan.
    let stillWanted = { () async -> Bool in
      await MainActor.run { !silent || (!Task.isCancelled && !isEditing && !isSaving && CalendarFeed.savedLink(for: athleteId) == link) }
    }
    guard let (feedData, feedResp) = try? await URLSession.shared.data(from: feed),
          (feedResp as? HTTPURLResponse)?.statusCode == 200 else {
      return await fail("Could not open that calendar link.")
    }
    guard let ics = CalendarFeed.calendarText(feedData) else {
      return await fail("That link did not return a calendar.")
    }
    guard await stillWanted() else { return await fail("") }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "athleteId": athleteId, "ics": ics, "today": PlanDay.today(), "timeZone": TimeZone.current.identifier, "refresh": refresh,
    ])
    do {
      let (data, resp) = try await URLSession.shared.data(for: req)
      let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
      if status == 200, let saved = try? JSONDecoder().decode(PlanSaveResponse.self, from: data) {
        // A paste that finished meanwhile wins on screen too.
        guard await stillWanted() else { return await fail("") }
        await MainActor.run {
          workouts = PlanDay.upcoming(saved.workouts, today: PlanDay.today())
          note = PlanDay.skippedNote(saved.rejected.count, unit: "event")
          isImporting = false
          if !silent { isEditing = false; feedLink = "" }
          CalendarFeed.save(link, for: athleteId)
          savedFeed = link
        }
        NotificationCenter.default.post(name: Notification.Name("planChanged"), object: nil)
      } else if status == 409 {
        // The plan is no longer the calendar import: stop refreshing it.
        await MainActor.run { CalendarFeed.save(nil, for: athleteId); savedFeed = nil }
        await fail((try? JSONDecoder().decode(PlanErrorResponse.self, from: data))?.error ?? "Your plan no longer comes from this calendar.")
      } else if status == 404 {
        await fail("Calendar import is not available yet.")
      } else {
        await fail((try? JSONDecoder().decode(PlanErrorResponse.self, from: data))?.error ?? "Importing the calendar failed.")
      }
    } catch {
      await fail(error.localizedDescription)
    }
  }
}
