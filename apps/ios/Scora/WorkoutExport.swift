import Foundation
import WorkoutKit
import HealthKit

// Apple WorkoutKit export (Plan tier, CLAUDE.md §5.2): a plan session's
// stored structure (scheduled_workouts.workout_structure_json, built by
// @scora/plan-engine from a reviewed template) becomes a CustomWorkout the
// Watch can run. The structure is copied as written: no step, duration or
// rep is added, dropped or rounded beyond whole seconds.
//
// Not wired to a button yet: scheduling to the Watch (WorkoutScheduler) needs
// a paired device to try.

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
    case "swim": return .swimming
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
    if let first = body.first, first.type == "warmup" {
      guard let m = first.durationMin, m > 0 else { throw WorkoutExportError.badStep(0) }
      warmup = WorkoutStep(goal: time(m))
      body.removeFirst()
    }
    if let last = body.last, last.type == "cooldown" {
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
