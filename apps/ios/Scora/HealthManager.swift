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
    async let sleep = lastNightSleepSeconds()
    async let hrv = latestHRV()
    async let rhr = latestRestingHR()
    async let hrvAvg = weekAvgHRV()
    let summary = HealthSummary(
      sleepSeconds: await sleep,
      hrvMs: await hrv,
      restingHr: await rhr,
      hrvWeekAvgMs: await hrvAvg
    )
    if summary.sleepSeconds == nil && summary.hrvMs == nil && summary.restingHr == nil {
      return nil
    }
    return summary
  }

  // MARK: - Queries

  private func lastNightSleepSeconds() async -> Double? {
    guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return nil }
    let start = Date().addingTimeInterval(-36 * 3600)
    let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: [])
    return await withCheckedContinuation { continuation in
      let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
        guard let samples = samples as? [HKCategorySample], !samples.isEmpty else {
          continuation.resume(returning: nil)
          return
        }
        // Sum "asleep" intervals (anything that isn't inBed or awake).
        let asleep = samples.filter { s in
          if #available(iOS 16.0, *) {
            return s.value != HKCategoryValueSleepAnalysis.inBed.rawValue
              && s.value != HKCategoryValueSleepAnalysis.awake.rawValue
          } else {
            return s.value == HKCategoryValueSleepAnalysis.asleep.rawValue
          }
        }
        let total = asleep.reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
        continuation.resume(returning: total > 0 ? total : nil)
      }
      store.execute(query)
    }
  }

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

  private func latestHRV() async -> Double? {
    await latestQuantity(.heartRateVariabilitySDNN, unit: HKUnit.secondUnit(with: .milli))
  }

  private func latestRestingHR() async -> Double? {
    await latestQuantity(.restingHeartRate, unit: HKUnit.count().unitDivided(by: .minute()))
  }

  private func weekAvgHRV() async -> Double? {
    guard let type = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) else { return nil }
    let start = Date().addingTimeInterval(-8 * 24 * 3600)
    let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: [])
    let unit = HKUnit.secondUnit(with: .milli)
    return await withCheckedContinuation { continuation in
      let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .discreteAverage) { _, stats, _ in
        guard let avg = stats?.averageQuantity() else {
          continuation.resume(returning: nil)
          return
        }
        continuation.resume(returning: avg.doubleValue(for: unit))
      }
      store.execute(query)
    }
  }
}
