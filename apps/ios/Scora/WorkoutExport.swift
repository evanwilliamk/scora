import Foundation
import WorkoutKit
import HealthKit

// Apple WorkoutKit export (Plan tier, CLAUDE.md §5.2): a plan session's
// stored structure (scheduled_workouts.workout_structure_json, built by
// @scora/plan-engine from a reviewed template) becomes a CustomWorkout the
// Watch can run. The structure is copied as written: no step, duration or
// rep is added, dropped or rounded beyond whole seconds.
//
// Scheduling to the Watch (WorkoutScheduler) is wired to "Send to Watch" on
// Your Plan; it has only run on the simulator so far and needs a paired
// device to try.

struct PlanStep: Decodable, Equatable {
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

// WorkoutScheduler behind a protocol so the flow is testable without a Watch.
protocol WatchScheduling {
  var isSupported: Bool { get }
  func authorize() async -> Bool
  func schedule(_ workout: CustomWorkout, at date: DateComponents) async
}

struct AppleWatchScheduler: WatchScheduling {
  var isSupported: Bool { WorkoutScheduler.isSupported }
  func authorize() async -> Bool {
    await WorkoutScheduler.shared.requestAuthorization() == .authorized
  }
  func schedule(_ workout: CustomWorkout, at date: DateComponents) async {
    await WorkoutScheduler.shared.schedule(WorkoutPlan(.custom(workout)), at: date)
  }
}

enum WatchSend {
  enum Outcome: Equatable {
    case sent(String) // the day label it was sent for
    case unsupported
    case notAuthorized
    case cannotCopy
  }

  // Only sessions the Watch can run as written, from today to a week out.
  static let daysAhead = 7

  static func canSend(type: String, steps: [PlanStep]?, date: String, today: String) -> Bool {
    guard let steps, !steps.isEmpty, (try? WorkoutExport.activity(for: type)) != nil else { return false }
    guard let d = day(date), let t = day(today) else { return false }
    let diff = Calendar(identifier: .gregorian).dateComponents([.day], from: t, to: d).day ?? -1
    return diff >= 0 && diff <= daysAhead
  }

  // 06:00 on the plan's date in the athlete's zone (the default read time),
  // so the session is waiting on the Watch that morning.
  static func scheduleTime(for date: String) -> DateComponents? {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    return DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 6, minute: 0)
  }

  static func send(
    steps: [PlanStep], type: String, date: String, displayName: String, dayLabel: String,
    scheduler: WatchScheduling
  ) async -> Outcome {
    guard scheduler.isSupported else { return .unsupported }
    guard let workout = try? WorkoutExport.customWorkout(steps: steps, plannedType: type, displayName: displayName),
          let when = scheduleTime(for: date) else { return .cannotCopy }
    guard await scheduler.authorize() else { return .notAuthorized }
    await scheduler.schedule(workout, at: when)
    return .sent(dayLabel)
  }

  static func message(_ o: Outcome) -> String {
    switch o {
    case .sent(let day): return "Sent to your Watch for \(day)."
    case .unsupported: return "This iPhone cannot send workouts to a Watch."
    case .notAuthorized: return "SCORA needs permission to send workouts to your Watch (Settings > Privacy > Health)."
    case .cannotCopy: return "This session cannot be copied to the Watch as written."
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
