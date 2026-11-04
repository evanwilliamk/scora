import Foundation

// Keeps the Watch in step with the plan (CLAUDE.md §6.2: a plan change is
// never silent). When the plan engine moves, downgrades or removes a session
// after it was sent with Send to Watch, the copy already scheduled for its old
// day would otherwise stay in WorkoutKit. Each time the plan loads (Your Plan,
// or the app coming to the foreground) this pass:
// - removes any SCORA workout scheduled for today or later whose day no
//   longer holds that session on the plan;
// - sends a moved session again for its new day only when this device sent
//   the original and the session is otherwise unchanged (same row, same
//   steps), within the Send to Watch window;
// - otherwise leaves a plain note next to the session (or its old day) so the
//   athlete can see what changed on the Watch and send it again if they want.
// Past days are never touched.
//
// A copy sent by this build carries its session's WatchPlanId, so the pass
// finds its session by id, on any phone, even when two sessions on one day
// share a name. Copies older builds sent (random ids) still match by day and
// name, with the records below; those records also say whether a moved
// session's steps are unchanged.

// One Send to Watch made on this device.
struct WatchSendRecord: Codable, Equatable {
  let date: String // plan day, YYYY-MM-DD
  let name: String // the Watch display name (the session's detail line)
  var rowId: String?
  var steps: [PlanStep]?
}

// What the pass did, said next to the session it is about. `key` is the
// session's row id, or "day:<date>" when the old day has no session left.
struct WatchNote: Codable, Equatable {
  let key: String
  let day: String // the day the note is about; it goes once that day passes
  let text: String
}

struct WatchLedger: Codable, Equatable {
  var sends: [WatchSendRecord] = []
  var notes: [WatchNote] = []

  // One record per session: by row id, or by day and name for a row without one.
  mutating func recordSend(_ w: PlanWorkout) {
    sends.removeAll { w.rowId != nil ? $0.rowId == w.rowId : ($0.rowId == nil && $0.date == w.date && $0.name == w.detail) }
    sends.append(WatchSendRecord(date: w.date, name: w.detail, rowId: w.rowId, steps: w.steps))
    notes.removeAll { $0.key == WatchReconcile.key(w) || $0.key == "day:\(w.date)" }
  }

  mutating func note(_ key: String, day: String, _ text: String) {
    notes.removeAll { $0.key == key }
    notes.append(WatchNote(key: key, day: day, text: text))
  }

  // The name this session was last sent under, so a resend replaces that
  // copy even after an adaptation renamed it.
  func lastSentName(_ w: PlanWorkout) -> String? {
    guard let rowId = w.rowId else { return nil }
    return sends.first { $0.rowId == rowId && $0.date == w.date }?.name
  }

  func pruned(today: String) -> WatchLedger {
    WatchLedger(sends: sends.filter { $0.date >= today }, notes: notes.filter { $0.day >= today })
  }

  func note(for w: PlanWorkout) -> String? {
    notes.first { $0.key == WatchReconcile.key(w) }?.text ?? notes.first { $0.key == "day:\(w.date)" }?.text
  }

  // Notes about a day the list does not show (its session is gone).
  func unattachedNotes(_ workouts: [PlanWorkout]) -> [String] {
    let keys = Set(workouts.flatMap { [WatchReconcile.key($0), "day:\($0.date)"] })
    return notes.filter { !keys.contains($0.key) }.map(\.text)
  }

  // Kept on this device, per athlete. Copies sent under a plan id do not need
  // it to be found; losing it only means a copy an older build sent is
  // removed rather than sent again when its session moves.
  private static func storageKey(_ athleteId: String) -> String { "watchLedger.\(athleteId)" }
  static func load(athleteId: String, defaults: UserDefaults = .standard) -> WatchLedger {
    guard let data = defaults.data(forKey: storageKey(athleteId)),
          let ledger = try? JSONDecoder().decode(WatchLedger.self, from: data) else { return WatchLedger() }
    return ledger
  }
  func save(athleteId: String, defaults: UserDefaults = .standard) {
    if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.storageKey(athleteId)) }
  }
  // Sign-out: the session names, days and steps go with the athlete.
  static func clear(athleteId: String, defaults: UserDefaults = .standard) {
    defaults.removeObject(forKey: storageKey(athleteId))
  }
}

extension PlanWorkout {
  // The names a copy of this session can carry on the Watch: its detail now,
  // and the same stored values written in km, as builds before miles named
  // them (a whole km bare, else one decimal) and as PlanDistance writes km.
  // Built from the stored km, so a really changed distance, duration or kind
  // still reads as a different name. Older builds' copies match on these.
  var watchNames: Set<String> {
    var names: Set<String> = [detail]
    guard let km = distanceKm else { return names }
    var parts = [intensity ?? type]
    if let durationMin { parts.append("\(durationMin) min") }
    let kmBefore = km.rounded() == km ? "\(Int(km)) km" : String(format: "%.1f km", km)
    for d in [kmBefore, PlanDistance.format(km: km, unit: .km)] {
      names.insert((parts + [d]).joined(separator: " · "))
    }
    return names
  }
}

enum WatchReconcile {
  enum Action: Equatable {
    // `id`: the copy's WatchPlanId; nil for an older build's copy, matched by day and name.
    case remove(day: String, name: String, id: UUID?)
    case resend(rowId: String, from: String)
  }

  struct Pass: Equatable {
    var actions: [Action]
    var ledger: WatchLedger
  }

  static func key(_ w: PlanWorkout) -> String { w.rowId.map { "row:\($0)" } ?? "day:\(w.date)" }

  // Components labeled with another calendar are converted, so a day is always
  // the plan's Gregorian day.
  static func day(_ c: DateComponents) -> String? {
    if let cal = c.calendar, cal.identifier != .gregorian, let at = cal.date(from: c) {
      return PlanDay.today(at, zone: c.timeZone ?? cal.timeZone)
    }
    guard let y = c.year, let m = c.month, let d = c.day else { return nil }
    return String(format: "%04d-%02d-%02d", y, m, d)
  }

  // "Tue Nov 3", as PlanWorkout.dayLabel writes it.
  static func label(_ date: String) -> String {
    PlanWorkout(date: date, type: "", intensity: nil, durationMin: nil, distanceKm: nil, description: nil).dayLabel
  }

  // Note texts. Plain words about the Watch copy; never what to do.
  static func movedAndSent(from: String) -> String { "Moved from \(label(from)). Its Watch copy moved with it." }
  static func movedNotSent(from: String) -> String {
    "Moved from \(label(from)). Its Watch copy for \(label(from)) was removed and has not been sent for this day."
  }
  static let changed = "This session changed after it was sent, so the earlier copy was removed from your Watch."
  static func changedOnDay(_ day: String) -> String {
    "A session on \(label(day)) changed after it was sent, so its earlier copy was removed from your Watch."
  }
  static func goneOnDay(_ day: String) -> String {
    "One of \(label(day))'s sessions is no longer on your plan, so its Watch copy was removed."
  }
  static func gone(_ day: String) -> String { "\(label(day))'s session is no longer on your plan, so its Watch copy was removed." }

  // Decides what to do, without touching the Watch. `coveredThrough`: the
  // last plan day the list is known to be complete for (the API returns the
  // next 14 sessions); days after it are left alone.
  static func plan(
    scheduled: [WatchCopy],
    workouts: [PlanWorkout],
    coveredThrough: String?,
    ledger: WatchLedger,
    today: String
  ) -> Pass {
    var ledger = ledger.pruned(today: today)
    var actions: [Action] = []
    var moveNoted = Set<String>() // a move's note outranks "changed" for the same session
    // Each scheduled copy on its own: a day can hold two sessions (a coach
    // plan), and only the copy that no longer matches is touched.
    var copies: [(day: String, name: String)] = [] // older builds' copies, by day and name
    var derived: [(day: String, copy: WatchCopy)] = [] // this build's, by id
    for s in scheduled {
      guard let d = day(s.at), d >= today else { continue } // never touch past days
      if let last = coveredThrough, d > last { continue }
      if WatchPlanId.isDerived(s.id) {
        if !derived.contains(where: { $0.day == d && $0.copy.id == s.id }) { derived.append((day: d, copy: s)) }
      } else if !copies.contains(where: { $0.day == d && $0.name == s.name }) {
        copies.append((day: d, name: s.name))
      }
    }
    for (d, c) in derived.sorted(by: { ($0.day, $0.copy.name) < ($1.day, $1.copy.name) }) {
      let sessions = workouts.filter { $0.date == d && $0.intensity != "rest" }
      let session = workouts.first { $0.rowId.map(WatchPlanId.forSession) == c.id }
      let record = ledger.sends.first { $0.date == d && $0.rowId.map(WatchPlanId.forSession) == c.id }
      if let w = session, w.date == d, w.intensity != "rest", w.steps != nil, w.watchNames.contains(c.name),
         record?.steps == nil || record?.steps == w.steps { continue } // still the plan's session
      actions.append(.remove(day: d, name: c.name, id: c.id))
      if let record { ledger.sends.removeAll { $0 == record } }
      if let moved = session, moved.date != d {
        moveNoted.insert(key(moved))
        // Unchanged: the steps this device recorded, or (no record, another
        // phone sent it) the Watch copy itself. When unsure, it is not resent.
        let unchanged = record.map { $0.steps != nil && $0.steps == moved.steps }
          ?? (c.workout != nil && c.workout == moved.steps.flatMap {
            try? WorkoutExport.customWorkout(steps: $0, plannedType: moved.type, displayName: moved.detail)
          })
        if moved.date > d, unchanged,
           WatchSend.canSend(type: moved.type, intensity: moved.intensity, steps: moved.steps, date: moved.date, today: today) {
          actions.append(.resend(rowId: moved.rowId!, from: d))
          ledger.notes.removeAll { $0.key == key(moved) }
        } else if moved.date >= today {
          ledger.note(key(moved), day: moved.date, movedNotSent(from: d))
        }
      } else if let w = session, w.intensity != "rest" {
        if !moveNoted.contains(key(w)) { ledger.note(key(w), day: d, changed) }
      } else if sessions.isEmpty {
        ledger.note("day:\(d)", day: d, gone(d))
      } else {
        ledger.note("day:\(d)", day: d, goneOnDay(d))
      }
    }
    for (d, name) in copies.sorted(by: { ($0.day, $0.name) < ($1.day, $1.name) }) {
      let sessions = workouts.filter { $0.date == d && $0.intensity != "rest" }
      let record = ledger.sends.first { $0.date == d && $0.name == name }
      let stillOnPlan = sessions.contains { s in
        s.steps != nil && s.watchNames.contains(name)
          && (record.map { ($0.rowId == nil || $0.rowId == s.rowId) && ($0.steps == nil || $0.steps == s.steps) } ?? true)
      }
      if stillOnPlan { continue } // the Watch copy is still the plan's session
      actions.append(.remove(day: d, name: name, id: nil))
      if let record { ledger.sends.removeAll { $0 == record } }

      if let rowId = record?.rowId, let moved = workouts.first(where: { $0.rowId == rowId && $0.date != d }) {
        moveNoted.insert(key(moved))
        if moved.date > d, record?.steps != nil, moved.steps == record?.steps,
           WatchSend.canSend(type: moved.type, intensity: moved.intensity, steps: moved.steps, date: moved.date, today: today) {
          actions.append(.resend(rowId: rowId, from: d))
          ledger.notes.removeAll { $0.key == key(moved) }
        } else if moved.date >= today {
          ledger.note(key(moved), day: moved.date, movedNotSent(from: d))
        }
      } else if let target = sessions.first(where: { $0.rowId != nil && $0.rowId == record?.rowId })
                  ?? fallbackTarget(sessions, record: record, namesThatDay: copies.filter { $0.day == d }.map(\.name)) {
        if !moveNoted.contains(key(target)) { ledger.note(key(target), day: d, changed) }
      } else if sessions.isEmpty {
        ledger.note("day:\(d)", day: d, gone(d))
      } else {
        let gone = record?.rowId.map { id in !workouts.contains { $0.rowId == id } } ?? false
        ledger.note("day:\(d)", day: d, gone ? goneOnDay(d) : changedOnDay(d))
      }
    }
    return Pass(actions: actions, ledger: ledger)
  }

  // Without a record naming the row, a lone session that day is taken to be
  // the changed one, unless its own copy is still on the Watch.
  private static func fallbackTarget(_ sessions: [PlanWorkout], record: WatchSendRecord?, namesThatDay: [String]) -> PlanWorkout? {
    guard record?.rowId == nil, sessions.count == 1, sessions[0].watchNames.isDisjoint(with: namesThatDay) else { return nil }
    return sessions[0]
  }

  // Runs the pass against the Watch. Only when SCORA is already allowed to
  // schedule workouts: it never asks for permission. Returns the new ledger.
  @MainActor
  static func run(
    workouts: [PlanWorkout], coveredThrough: String?, ledger: WatchLedger,
    scheduler: WatchScheduling, today: String = PlanDay.today(), now: Date = Date()
  ) async -> WatchLedger {
    guard scheduler.isSupported, await scheduler.isAuthorized() else { return ledger }
    let scheduled = await scheduler.scheduledWorkouts()
    var pass = plan(scheduled: scheduled, workouts: workouts, coveredThrough: coveredThrough, ledger: ledger, today: today)
    // Every removal first, so a later day's stale copy never takes a resend with it.
    for case .remove(let d, let name, let id) in pass.actions {
      await scheduler.removeScheduled { c in
        guard day(c.at) == d else { return false }
        if let id { return c.id == id }
        return !WatchPlanId.isDerived(c.id) && c.name == name
      }
    }
    for a in pass.actions {
      switch a {
      case .remove:
        continue
      case .resend(let rowId, let from):
        guard let w = workouts.first(where: { $0.rowId == rowId }), let steps = w.steps else { continue }
        let outcome = await WatchSend.send(
          steps: steps, type: w.type, date: w.date, displayName: w.detail, dayLabel: w.dayLabel, rowId: rowId,
          scheduler: scheduler, now: now)
        if case .sent = outcome {
          pass.ledger.recordSend(w)
          pass.ledger.note(key(w), day: w.date, movedAndSent(from: from))
        } else {
          pass.ledger.note(key(w), day: w.date, movedNotSent(from: from))
        }
      }
    }
    return pass.ledger
  }

  @MainActor private static var inFlight = false

  // The app came to the foreground: read the plan and run the pass, if this
  // device can already schedule Watch workouts. Quiet on any failure.
  @MainActor
  static func refresh(athleteId: String, apiBase: String, scheduler: WatchScheduling = AppleWatchScheduler()) async {
    #if DEBUG
    if DemoMode.isOn || DemoMode.planSessions != nil { return }
    #endif
    guard !inFlight, !athleteId.isEmpty, scheduler.isSupported, await scheduler.isAuthorized() else { return }
    let today = PlanDay.today()
    var comps = URLComponents(string: "\(apiBase)/api/plan")
    comps?.queryItems = [URLQueryItem(name: "athleteId", value: athleteId), URLQueryItem(name: "today", value: today)]
    guard let url = comps?.url,
          let (data, resp) = try? await API.session.data(from: url),
          (resp as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(PlanListResponse.self, from: data)
    else { return }
    await reconcile(decoded.workouts, athleteId: athleteId, scheduler: scheduler, today: today)
  }

  // Runs the pass on a freshly loaded plan and saves the ledger.
  @MainActor
  @discardableResult
  // `signedIn`: who is signed in as the plan lands. The Watch belongs to the
  // phone, so a plan fetched for an athlete who has since signed out (or been
  // replaced) never removes or sends copies, and nothing is saved for them.
  static func reconcile(_ workouts: [PlanWorkout], athleteId: String, scheduler: WatchScheduling = AppleWatchScheduler(),
                        today: String = PlanDay.today(),
                        signedIn: @escaping () -> String? = { UserDefaults.standard.string(forKey: "scora.athleteId") }) async -> WatchLedger {
    let ledger = WatchLedger.load(athleteId: athleteId)
    // One pass at a time (Your Plan and the foreground can both start one).
    guard !inFlight, !athleteId.isEmpty, signedIn() == athleteId else { return ledger }
    inFlight = true
    defer { inFlight = false }
    let updated = await run(workouts: workouts, coveredThrough: coveredThrough(workouts), ledger: ledger, scheduler: scheduler, today: today)
    // Signed out during the pass: sign-out already removed their ledger.
    if signedIn() == athleteId { updated.save(athleteId: athleteId) }
    return updated
  }

  // GET /api/plan returns at most 14 sessions: a full page only covers the
  // plan up to its last date.
  static let pageSize = 14
  static func coveredThrough(_ workouts: [PlanWorkout]) -> String? {
    workouts.count >= pageSize ? workouts.map(\.date).max() : nil
  }
}
