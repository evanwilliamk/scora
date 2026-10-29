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

enum HealthNights {
  // Asleep samples one hour apart or less form one sleep session, measured as
  // the union of its samples (Watch and iPhone samples that overlap count
  // once). Each wake day keeps its longest session, so a nap never adds to
  // the night. HRV and resting HR take the day's last sample, the same value
  // the read cites as the latest.
  static func group(
    sleep: [(start: Date, end: Date)],
    hrv: [(date: Date, value: Double)],
    restingHr: [(date: Date, value: Double)],
    calendar: Calendar = .current
  ) -> [HealthNight] {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = calendar.timeZone
    f.dateFormat = "yyyy-MM-dd"
    var nights: [String: HealthNight] = [:]
    func touch(_ day: String, _ edit: (inout HealthNight) -> Void) {
      var n = nights[day] ?? HealthNight(day: day)
      edit(&n)
      nights[day] = n
    }

    var sessions: [(end: Date, asleep: TimeInterval)] = []
    var cur: (start: Date, end: Date, asleep: TimeInterval)?
    for s in sleep.filter({ $0.end > $0.start }).sorted(by: { $0.start < $1.start }) {
      if var c = cur, s.start <= c.end.addingTimeInterval(3600) {
        // Count only the part not already covered.
        let from = max(s.start, c.end)
        if s.end > from { c.asleep += s.end.timeIntervalSince(from) }
        c.end = max(c.end, s.end)
        cur = c
      } else {
        if let c = cur { sessions.append((end: c.end, asleep: c.asleep)) }
        cur = (start: s.start, end: s.end, asleep: s.end.timeIntervalSince(s.start))
      }
    }
    if let c = cur { sessions.append((end: c.end, asleep: c.asleep)) }
    for s in sessions {
      touch(f.string(from: s.end)) { $0.sleepSeconds = max($0.sleepSeconds ?? 0, s.asleep) }
    }

    func lastPerDay(_ xs: [(date: Date, value: Double)]) -> [String: Double] {
      Dictionary(grouping: xs, by: { f.string(from: $0.date) }).mapValues { $0.max(by: { $0.date < $1.date })!.value }
    }
    for (day, v) in lastPerDay(hrv) { touch(day) { $0.hrvMs = (v * 10).rounded() / 10 } }
    for (day, v) in lastPerDay(restingHr) { touch(day) { $0.restingHr = v.rounded() } }
    return nights.values.sorted { $0.day < $1.day }
  }

  // Last night is the night whose wake day is today, from the grouped nights,
  // so iPhone and Watch samples of the same hours count once and naps never
  // add to it.
  static func lastNightSleep(_ nights: [HealthNight], today: String) -> Double? {
    nights.first { $0.day == today }?.sleepSeconds
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
    async let hrv = latestHRV()
    async let rhr = latestRestingHR()
    let nights = await recentNights()
    let summary = HealthSummary(
      sleepSeconds: HealthNights.lastNightSleep(nights ?? [], today: HealthNights.localToday()),
      hrvMs: await hrv,
      restingHr: await rhr,
      hrvWeekAvgMs: HealthNights.weekAverageHRV(nights ?? []),
      nights: nights
    )
    if summary.sleepSeconds == nil && summary.hrvMs == nil && summary.restingHr == nil {
      return nil
    }
    return summary
  }

  // MARK: - Queries

  private func latestQuantity(_ id: HKQuantityTypeIdentifier, unit: HKUnit) async -> Double? {
    guard let type = HKObjectType.quantityType(forIdentifier: id) else { return nil }
    let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
    return await withCheckedContinuation { continuation in
      let query = HKSampleQuery(sampleType: type, predicate: nil, limit: 1, sortDescriptors: sort) { _, samples, _ in
        guard let sample = samples?.first as? HKQuantitySample else {
          continuation.resume(returning: nil)
          return
        }
        continuation.resume(returning: sample.quantity.doubleValue(for: unit))
      }
      store.execute(query)
    }
  }

  // The last 28 days, grouped into dated nights (HealthNights.group).
  private func recentNights(days: Double = 28) async -> [HealthNight]? {
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
    let hrv = (await samples(hrvType)).compactMap { $0 as? HKQuantitySample }.map { (date: $0.endDate, value: $0.quantity.doubleValue(for: ms)) }
    let rhr = (await samples(rhrType)).compactMap { $0 as? HKQuantitySample }.map { (date: $0.endDate, value: $0.quantity.doubleValue(for: bpm)) }
    let nights = HealthNights.group(sleep: asleep.map { (start: $0.startDate, end: $0.endDate) }, hrv: hrv, restingHr: rhr)
    return nights.isEmpty ? nil : nights
  }

  private func latestHRV() async -> Double? {
    await latestQuantity(.heartRateVariabilitySDNN, unit: HKUnit.secondUnit(with: .milli))
  }

  private func latestRestingHR() async -> Double? {
    await latestQuantity(.restingHeartRate, unit: HKUnit.count().unitDivided(by: .minute()))
  }
}
