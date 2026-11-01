import Foundation
import WorkoutKit
import HealthKit
import CryptoKit

// Apple WorkoutKit export (Plan tier, CLAUDE.md §5.2): a plan session's
// stored structure (scheduled_workouts.workout_structure_json, built by
// @scora/plan-engine from a reviewed template) becomes a CustomWorkout the
// Watch can run. The structure is copied as written: no step, duration or
// rep is added, dropped or rounded beyond whole seconds.
//
// Scheduling to the Watch (WorkoutScheduler) is wired to "Send to Watch" on
// Your Plan; it has only run on the simulator so far and needs a paired
// device to try.

struct PlanStep: Codable, Equatable {
  let type: String // warmup | steady | interval | cooldown
  let durationMin: Double?
  let intensity: String?
  let reps: Int?
  let workDurationMin: Double?
  let workIntensity: String?
  let restDurationMin: Double?
  let restIntensity: String?

  enum CodingKeys: String, CodingKey {
    case type, intensity, reps
    case durationMin = "duration_min", workDurationMin = "work_duration_min", workIntensity = "work_intensity"
    case restDurationMin = "rest_duration_min", restIntensity = "rest_intensity"
  }
}

enum WorkoutExportError: Error, Equatable {
  case empty
  case badStep(Int)
  case unsupportedActivity(String)
}

enum WorkoutExport {
  static func activity(for plannedType: String) throws -> HKWorkoutActivityType {
    switch plannedType {
    case "run": return .running
    case "ride": return .cycling
    // Swims are left out: the plan does not say pool or open water, and the
    // Watch needs to know which.
    default: throw WorkoutExportError.unsupportedActivity(plannedType)
    }
  }

  private static func time(_ minutes: Double) -> WorkoutGoal {
    .time((minutes * 60).rounded(), .seconds)
  }

  // A leading warmup and a trailing cooldown map to WorkoutKit's own; every
  // step in between becomes a block (an interval step repeats its reps).
  static func customWorkout(
    steps: [PlanStep],
    plannedType: String,
    displayName: String
  ) throws -> CustomWorkout {
    guard !steps.isEmpty else { throw WorkoutExportError.empty }
    let activity = try activity(for: plannedType)
    var body = steps
    var warmup: WorkoutStep?
    var cooldown: WorkoutStep?
    // Only split off a warmup and cooldown when a main block remains;
    // otherwise (a warmup-only session) every step stays a block, so the
    // workout is never empty.
    let mains = steps.enumerated().filter { i, s in
      !((i == 0 && s.type == "warmup") || (i == steps.count - 1 && s.type == "cooldown"))
    }
    if mains.isEmpty {
      body = steps
    } else if let first = body.first, first.type == "warmup" {
      guard let m = first.durationMin, m > 0 else { throw WorkoutExportError.badStep(0) }
      warmup = WorkoutStep(goal: time(m))
      body.removeFirst()
    }
    if !mains.isEmpty, let last = body.last, last.type == "cooldown" {
      guard let m = last.durationMin, m > 0 else { throw WorkoutExportError.badStep(steps.count - 1) }
      cooldown = WorkoutStep(goal: time(m))
      body.removeLast()
    }
    let offset = warmup == nil ? 0 : 1
    // The plan has no recovery after the last rep (reps x work + (reps - 1) x
    // rest), so a repeated [work, recovery] block runs reps - 1 times and the
    // last rep is its own block. The Watch total then equals the plan's.
    let blocks: [IntervalBlock] = try body.enumerated().flatMap { i, s -> [IntervalBlock] in
      func block(_ steps: [IntervalStep], _ n: Int) -> IntervalBlock {
        var b = IntervalBlock()
        b.steps = steps
        b.iterations = n
        return b
      }
      switch s.type {
      case "interval":
        guard let reps = s.reps, reps >= 1, let work = s.workDurationMin, work > 0 else {
          throw WorkoutExportError.badStep(i + offset)
        }
        let workStep = IntervalStep(.work, goal: time(work))
        if reps > 1, let rest = s.restDurationMin, rest > 0 {
          return [block([workStep, IntervalStep(.recovery, goal: time(rest))], reps - 1), block([workStep], 1)]
        }
        return [block([workStep], reps)]
      case "steady", "warmup", "cooldown":
        guard let m = s.durationMin, m > 0 else { throw WorkoutExportError.badStep(i + offset) }
        return [block([IntervalStep(.work, goal: time(m))], 1)]
      default:
        throw WorkoutExportError.badStep(i + offset)
      }
    }
    return CustomWorkout(activity: activity, location: .outdoor, displayName: displayName,
                         warmup: warmup, blocks: blocks, cooldown: cooldown)
  }

  static func customWorkout(json: Data, plannedType: String, displayName: String) throws -> CustomWorkout {
    try customWorkout(steps: JSONDecoder().decode([PlanStep].self, from: json), plannedType: plannedType, displayName: displayName)
  }
}

// MARK: - Send to Watch

// The Watch keeps each scheduled plan's id (WorkoutPlan.id, read back from
// WorkoutScheduler.scheduledWorkouts), so a session's copy carries an id
// derived from its plan row: the same row always gives the same id, on any
// phone. Name-based UUID v5 (RFC 4122) over a fixed SCORA namespace.
enum WatchPlanId {
  // Fixed forever: changing it orphans every copy already on a Watch.
  static let namespace = UUID(uuidString: "5c0a7e2a-9d4b-4f61-8a3e-2b7f0c1d6e58")!

  static func forSession(rowId: String) -> UUID { uuid5(namespace: namespace, name: "session:\(rowId)") }

  // Copies sent by builds before this one carry a random (v4) id.
  static func isDerived(_ id: UUID) -> Bool { (id.uuid.6 >> 4) == 5 }

  static func uuid5(namespace: UUID, name: String) -> UUID {
    var data = withUnsafeBytes(of: namespace.uuid) { Data($0) }
    data.append(Data(name.utf8))
    var b = Array(Insecure.SHA1.hash(data: data).prefix(16))
    b[6] = (b[6] & 0x0F) | 0x50
    b[8] = (b[8] & 0x3F) | 0x80
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
  }
}

// One of SCORA's scheduled Watch workouts. `id` is its WorkoutPlan id: a
// WatchPlanId for sends from this build on, random for older ones.
// `workout` is what the Watch will run (nil when it is not a custom workout).
struct WatchCopy {
  var name: String
  var at: DateComponents
  var id: UUID = UUID()
  var workout: CustomWorkout? = nil
}

// WorkoutScheduler behind a protocol so the flow is testable without a Watch.
protocol WatchScheduling {
  var isSupported: Bool { get }
  var maxScheduled: Int { get }
  func authorize() async -> Bool
  // Already authorized, without asking (the reconcile pass never prompts).
  func isAuthorized() async -> Bool
  // This app's scheduled workouts.
  func scheduledWorkouts() async -> [WatchCopy]
  func scheduledCount() async -> Int
  // Removes this app's scheduled workouts that match.
  func removeScheduled(where match: (WatchCopy) -> Bool) async
  // `id`: the plan id to schedule under (a random one when nil).
  func schedule(_ workout: CustomWorkout, id: UUID?, at date: DateComponents) async
}

struct AppleWatchScheduler: WatchScheduling {
  var isSupported: Bool { WorkoutScheduler.isSupported }
  var maxScheduled: Int { WorkoutScheduler.maxAllowedScheduledWorkoutCount }
  func authorize() async -> Bool {
    await WorkoutScheduler.shared.requestAuthorization() == .authorized
  }
  func isAuthorized() async -> Bool {
    await WorkoutScheduler.shared.authorizationState == .authorized
  }
  func scheduledCount() async -> Int {
    await WorkoutScheduler.shared.scheduledWorkouts.count
  }
  private static func copy(_ s: ScheduledWorkoutPlan) -> WatchCopy {
    guard case .custom(let w) = s.plan.workout else { return WatchCopy(name: "", at: s.date, id: s.plan.id) }
    return WatchCopy(name: w.displayName ?? "", at: s.date, id: s.plan.id, workout: w)
  }
  func scheduledWorkouts() async -> [WatchCopy] {
    await WorkoutScheduler.shared.scheduledWorkouts.map(Self.copy)
  }
  func removeScheduled(where match: (WatchCopy) -> Bool) async {
    for s in await WorkoutScheduler.shared.scheduledWorkouts {
      guard case .custom = s.plan.workout, match(Self.copy(s)) else { continue }
      await WorkoutScheduler.shared.remove(s.plan, at: s.date)
    }
  }
  func schedule(_ workout: CustomWorkout, id: UUID?, at date: DateComponents) async {
    await WorkoutScheduler.shared.schedule(WorkoutPlan(.custom(workout), id: id ?? UUID()), at: date)
  }
}

enum WatchSend {
  enum Outcome: Equatable {
    case sent(String) // the day label it was sent for
    case unsupported
    case notAuthorized
    case cannotCopy
    case full
    case dayPassed(String) // the day label of a session whose day is over
  }

  // Only sessions the Watch can run as written, from today to a week out.
  static let daysAhead = 7

  // A rest day is never sent, whatever steps its row carries.
  static func canSend(type: String, intensity: String? = nil, steps: [PlanStep]?, date: String, today: String) -> Bool {
    guard intensity != "rest" else { return false }
    guard let steps, !steps.isEmpty, (try? WorkoutExport.activity(for: type)) != nil else { return false }
    guard let d = day(date), let t = day(today) else { return false }
    // Both dates are UTC midnights; counting in UTC keeps a DST change in the
    // device zone from shortening the gap by an hour (and so by a day).
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    let diff = utc.dateComponents([.day], from: t, to: d).day ?? -1
    return diff >= 0 && diff <= daysAhead
  }

  // 06:00 on the plan's date (the default read time). For today once 06:00
  // has passed, a minute from now, so the session is never set in the past;
  // in the day's last minute, 23:59:59, so it stays on its day.
  static func scheduleTime(for date: String, now: Date = Date(), calendar: Calendar = .current) -> DateComponents? {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    let six = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 6, minute: 0)
    guard let sixAt = calendar.date(from: six), sixAt <= now else { return six }
    let n = calendar.dateComponents([.year, .month, .day], from: now)
    // Past the plan's day entirely (a stale screen): nothing to schedule.
    guard n.year == parts[0] && n.month == parts[1] && n.day == parts[2] else { return nil }
    let c = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: now.addingTimeInterval(60))
    if c.year == parts[0] && c.month == parts[1] && c.day == parts[2] { return c }
    return DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 23, minute: 59, second: 59)
  }

  // `rowId`: the session's plan row; its copy is sent under that row's
  // WatchPlanId. `replacing`: the name this session was last sent under
  // (WatchLedger keeps it per session), for a copy an older build sent.
  static func send(
    steps: [PlanStep], type: String, date: String, displayName: String, dayLabel: String,
    rowId: String? = nil, replacing: String? = nil, scheduler: WatchScheduling, now: Date = Date()
  ) async -> Outcome {
    guard scheduler.isSupported else { return .unsupported }
    guard let workout = try? WorkoutExport.customWorkout(steps: steps, plannedType: type, displayName: displayName)
    else { return .cannotCopy }
    guard let when = scheduleTime(for: date, now: now) else {
      // A screen left open overnight still shows yesterday's session.
      return day(date) != nil ? .dayPassed(dayLabel) : .cannotCopy
    }
    guard await scheduler.authorize() else { return .notAuthorized }
    let id = rowId.map(WatchPlanId.forSession)
    let today = WatchReconcile.day(Calendar.current.dateComponents([.year, .month, .day], from: now)) ?? date
    // Sending again replaces this session's earlier copy: by its id on any
    // day from today (it may have moved), or, for a copy an older build sent
    // (no derived id), by that day and its name or the older name it was
    // sent under (an adaptation renames it, tempo to endurance). Another
    // session the same day (a coach plan can hold two) stays, even under the
    // same name. The scheduler only lists SCORA's sends.
    await scheduler.removeScheduled { c in
      if let id, c.id == id { return (WatchReconcile.day(c.at) ?? "") >= today }
      guard !WatchPlanId.isDerived(c.id) else { return false }
      return c.at.year == when.year && c.at.month == when.month && c.at.day == when.day
        && (c.name == displayName || c.name == replacing)
    }
    guard await scheduler.scheduledCount() < scheduler.maxScheduled else { return .full }
    await scheduler.schedule(workout, id: id, at: when)
    return .sent(dayLabel)
  }

  static func message(_ o: Outcome) -> String {
    switch o {
    case .sent(let day): return "Sent to your Watch for \(day)."
    case .unsupported: return "This iPhone cannot send workouts to a Watch."
    case .notAuthorized: return "SCORA needs permission to send workouts to your Watch (Settings > Privacy > Health)."
    case .cannotCopy: return "This session cannot be copied to the Watch as written."
    case .full: return "Your Watch has as many scheduled workouts as it can hold. Remove one in the Workout app, then send again."
    case .dayPassed(let day): return "\(day) has passed, so this session was not sent."
    }
  }

  private static func day(_ s: String) -> Date? {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd"
    return f.date(from: s)
  }
}
