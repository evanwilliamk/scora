import Foundation
import HealthKit

// Reads sleep + recovery signals from HealthKit. HealthKit data is on-device
// only, so the app reads a summary and sends it up with the daily-read request;
// the backend uses it for the Sleep + Recovery cards when Oura isn't connected.
struct HealthSummary: Codable {
  var sleepSeconds: Double?
  var hrvMs: Double?
  var restingHr: Double?
  var hrvWeekAvgMs: Double?
  // Dated nights (oldest first) for the inline charts. Only days with a
  // recorded value appear; nothing is filled in.
  var nights: [HealthNight]?
}

struct HealthNight: Codable, Equatable {
  let day: String // YYYY-MM-DD, local
  var sleepSeconds: Double?
  var hrvMs: Double?
  var restingHr: Double?
}

// One HRV reading as HealthKit stores it, with the app that wrote it (the
// Watch, or Oura writing into Health), so a night reads from one source.
struct HRVSample: Equatable {
  let date: Date
  let value: Double
  var source: String = ""
}

enum HealthNights {
  typealias Session = (start: Date, end: Date, asleep: TimeInterval)

  // Asleep samples one hour apart or less form one sleep session, measured as
  // the union of its samples (Watch and iPhone samples that overlap count
  // once).
  static func sessions(_ sleep: [(start: Date, end: Date)]) -> [Session] {
    var out: [Session] = []
    var cur: Session?
    for s in sleep.filter({ $0.end > $0.start }).sorted(by: { $0.start < $1.start }) {
      if var c = cur, s.start <= c.end.addingTimeInterval(3600) {
        // Count only the part not already covered.
        let from = max(s.start, c.end)
        if s.end > from { c.asleep += s.end.timeIntervalSince(from) }
        c.end = max(c.end, s.end)
        cur = c
      } else {
        if let c = cur { out.append(c) }
        cur = (start: s.start, end: s.end, asleep: s.end.timeIntervalSince(s.start))
      }
    }
    if let c = cur { out.append(c) }
    return out
  }

  // The hours that count as the night ending on `day` (its wake day, local):
  // that day's longest sleep session, plus 30 minutes after waking for a
  // reading that closes just after. Without sleep data for that day, 20:00
  // the evening before to 10:00 that morning, in the given time zone.
  static let afterWake: TimeInterval = 30 * 60
  static func nightWindow(day: String, sessions: [Session], calendar: Calendar = .current) -> (start: Date, end: Date)? {
    let f = dayFormatter(calendar)
    if let s = sessions.filter({ f.string(from: $0.end) == day }).max(by: { $0.asleep < $1.asleep }) {
      return (start: s.start, end: s.end.addingTimeInterval(afterWake))
    }
    guard let midnight = f.date(from: day),
          let end = calendar.date(bySettingHour: 10, minute: 0, second: 0, of: midnight),
          let eve = calendar.date(byAdding: .day, value: -1, to: midnight),
          let start = calendar.date(bySettingHour: 20, minute: 0, second: 0, of: eve) else { return nil }
    return (start: start, end: end)
  }

  // One night's HRV: only readings inside the window, and only from one
  // source (the one with the most readings that night; on a tie, the one
  // with the latest reading), so Watch and Oura values never mix. The
  // night's value is that source's latest reading.
  static func nightHRV(_ samples: [HRVSample], in window: (start: Date, end: Date)) -> Double? {
    let inside = samples.filter { $0.date >= window.start && $0.date <= window.end }
    let bySource = Dictionary(grouping: inside, by: \.source)
    let pick = bySource.max { a, b in
      if a.value.count != b.value.count { return a.value.count < b.value.count }
      let la = a.value.map(\.date).max()!, lb = b.value.map(\.date).max()!
      if la != lb { return la < lb }
      return a.key > b.key
    }
    return pick?.value.max(by: { $0.date < $1.date }).map { ($0.value * 10).rounded() / 10 }
  }

  // Each wake day keeps its longest session, so a nap never adds to the
  // night. HRV is each night's (nightHRV); resting HR takes the day's last
  // sample.
  static func group(
    sleep: [(start: Date, end: Date)],
    hrv: [HRVSample],
    restingHr: [(date: Date, value: Double)],
    calendar: Calendar = .current
  ) -> [HealthNight] {
    let f = dayFormatter(calendar)
    var nights: [String: HealthNight] = [:]
    func touch(_ day: String, _ edit: (inout HealthNight) -> Void) {
      var n = nights[day] ?? HealthNight(day: day)
      edit(&n)
      nights[day] = n
    }

    let sessions = sessions(sleep)
    for s in sessions {
      touch(f.string(from: s.end)) { $0.sleepSeconds = max($0.sleepSeconds ?? 0, s.asleep) }
    }

    // A reading can belong to the night ending on its own day or the next.
    var days = Set<String>()
    for s in hrv {
      days.insert(f.string(from: s.date))
      if let next = calendar.date(byAdding: .day, value: 1, to: s.date) { days.insert(f.string(from: next)) }
    }
    for day in days {
      guard let w = nightWindow(day: day, sessions: sessions, calendar: calendar), let v = nightHRV(hrv, in: w) else { continue }
      touch(day) { $0.hrvMs = v }
    }

    func lastPerDay(_ xs: [(date: Date, value: Double)]) -> [String: Double] {
      Dictionary(grouping: xs, by: { f.string(from: $0.date) }).mapValues { $0.max(by: { $0.date < $1.date })!.value }
    }
    for (day, v) in lastPerDay(restingHr) { touch(day) { $0.restingHr = v.rounded() } }
    return nights.values.sorted { $0.day < $1.day }
  }

  private static func dayFormatter(_ calendar: Calendar) -> DateFormatter {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = calendar.timeZone
    f.calendar = calendar
    f.dateFormat = "yyyy-MM-dd"
    return f
  }

  // Last night is the night whose wake day is today, from the grouped nights,
  // so iPhone and Watch samples of the same hours count once and naps never
  // add to it.
  static func lastNightSleep(_ nights: [HealthNight], today: String) -> Double? {
    nights.first { $0.day == today }?.sleepSeconds
  }

  // Last night's resting HR: the newest sample within the last 36 hours,
  // never the newest sample ever. A 6 AM read often has none dated today
  // (resting HR is written later in the day), so yesterday's still counts; a
  // value from days ago is sent as nil, since the API reads it as last night's.
  static let recentWindow: TimeInterval = 36 * 3600

  static func newestRecent(_ xs: [(date: Date, value: Double)], now: Date = Date(), window: TimeInterval = recentWindow) -> Double? {
    xs.filter { $0.date <= now && now.timeIntervalSince($0.date) <= window }
      .max(by: { $0.date < $1.date })?.value
  }

  // Last night's HRV: only readings inside last night's sleep window (or
  // 20:00 to 10:00 local without sleep data), from one source. A daytime
  // reading, or one from the night before, is never cited as last night's.
  static func lastNightHRV(
    _ samples: [HRVSample], sleep: [(start: Date, end: Date)], now: Date = Date(), calendar: Calendar = .current
  ) -> Double? {
    let today = localToday(calendar, now: now)
    guard let w = nightWindow(day: today, sessions: sessions(sleep), calendar: calendar) else { return nil }
    return nightHRV(samples, in: (start: w.start, end: min(w.end, now)))
  }

  static func lastNightRestingHR(_ samples: [(date: Date, value: Double)], now: Date = Date()) -> Double? {
    newestRecent(samples, now: now).map { $0.rounded() }
  }

  // The nights in the 7 days before the newest one, one value per night: the
  // baseline the API compares last night's HRV with (oura.ts does the same).
  static func weekAverageHRV(_ nights: [HealthNight]) -> Double? {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd"
    // The newest night with an HRV value is the one compared, never averaged.
    guard let newest = nights.last(where: { $0.hrvMs != nil })?.day, let newestDate = f.date(from: newest) else { return nil }
    let from = f.string(from: newestDate.addingTimeInterval(-7 * 86400))
    let values = nights.filter { $0.day >= from && $0.day < newest }.compactMap { $0.hrvMs }
    guard !values.isEmpty else { return nil }
    return (values.reduce(0, +) / Double(values.count) * 10).rounded() / 10
  }

  static func localToday(_ calendar: Calendar = .current, now: Date = Date()) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = calendar.timeZone
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: now)
  }
}

final class HealthManager {
  static let shared = HealthManager()
  private let store = HKHealthStore()

  private var readTypes: Set<HKObjectType> {
    var types = Set<HKObjectType>()
    if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
    if let hrv = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) { types.insert(hrv) }
    if let rhr = HKObjectType.quantityType(forIdentifier: .restingHeartRate) { types.insert(rhr) }
    return types
  }

  func requestAuthorization() async -> Bool {
    #if DEBUG
    if DemoMode.isOn { return false } // no system prompts over the demo screen
    #endif
    guard HKHealthStore.isHealthDataAvailable() else { return false }
    do {
      try await store.requestAuthorization(toShare: [], read: readTypes)
      return true
    } catch {
      return false
    }
  }

  // Returns nil when HealthKit is unavailable or has nothing to report, so the
  // caller can simply omit the summary and fall back to connect prompts.
  func fetchSummary() async -> HealthSummary? {
    guard HKHealthStore.isHealthDataAvailable() else { return nil }
    let recent = await recentNights()
    let nights = recent?.nights
    let today = HealthNights.localToday()
    let now = Date()
    let summary = HealthSummary(
      sleepSeconds: HealthNights.lastNightSleep(nights ?? [], today: today),
      hrvMs: HealthNights.lastNightHRV(recent?.hrv ?? [], sleep: recent?.sleep ?? [], now: now),
      restingHr: HealthNights.lastNightRestingHR(recent?.restingHr ?? [], now: now),
      hrvWeekAvgMs: HealthNights.weekAverageHRV(nights ?? []),
      nights: nights
    )
    if summary.sleepSeconds == nil && summary.hrvMs == nil && summary.restingHr == nil {
      return nil
    }
    return summary
  }

  // MARK: - Queries

  // The last 28 days, grouped into dated nights (HealthNights.group), plus the
  // raw sleep, HRV and resting HR samples for last night's values.
  private typealias Samples = [(date: Date, value: Double)]
  private typealias Intervals = [(start: Date, end: Date)]
  private func recentNights(days: Double = 28) async -> (nights: [HealthNight]?, sleep: Intervals, hrv: [HRVSample], restingHr: Samples)? {
    let start = Date().addingTimeInterval(-days * 24 * 3600)
    let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: [])
    func samples(_ type: HKSampleType) async -> [HKSample] {
      await withCheckedContinuation { continuation in
        let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, s, _ in
          continuation.resume(returning: s ?? [])
        }
        store.execute(q)
      }
    }
    guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
          let hrvType = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN),
          let rhrType = HKObjectType.quantityType(forIdentifier: .restingHeartRate) else { return nil }
    let asleep = (await samples(sleepType)).compactMap { $0 as? HKCategorySample }.filter { s in
      if #available(iOS 16.0, *) {
        return s.value != HKCategoryValueSleepAnalysis.inBed.rawValue && s.value != HKCategoryValueSleepAnalysis.awake.rawValue
      } else {
        return s.value == HKCategoryValueSleepAnalysis.asleep.rawValue
      }
    }
    let ms = HKUnit.secondUnit(with: .milli)
    let bpm = HKUnit.count().unitDivided(by: .minute())
    let hrv = (await samples(hrvType)).compactMap { $0 as? HKQuantitySample }.map {
      HRVSample(date: $0.endDate, value: $0.quantity.doubleValue(for: ms), source: $0.sourceRevision.source.bundleIdentifier)
    }
    let rhr = (await samples(rhrType)).compactMap { $0 as? HKQuantitySample }.map { (date: $0.endDate, value: $0.quantity.doubleValue(for: bpm)) }
    let sleep = asleep.map { (start: $0.startDate, end: $0.endDate) }
    let nights = HealthNights.group(sleep: sleep, hrv: hrv, restingHr: rhr)
    return (nights: nights.isEmpty ? nil : nights, sleep: sleep, hrv: hrv, restingHr: rhr)
  }
}
