import HealthKit
import Foundation

@MainActor
class HealthKitManager: ObservableObject {
    static let shared = HealthKitManager()

    private let store = HKHealthStore()

    @Published var isAuthorized = false
    @Published var authorizationDenied = false

    private let readTypes: Set<HKObjectType> = {
        var types: Set<HKObjectType> = []
        let quantityIds: [HKQuantityTypeIdentifier] = [
            .heartRate,
            .activeEnergyBurned,
            .basalEnergyBurned,
            .stepCount,
            .bodyMass
        ]
        for id in quantityIds {
            types.insert(HKQuantityType(id))
        }
        types.insert(HKObjectType.workoutType())
        return types
    }()

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            authorizationDenied = true
            return
        }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            isAuthorized = true
        } catch {
            authorizationDenied = true
        }
    }

    // MARK: - Active Energy

    func fetchActiveEnergy(for date: Date) async -> Double {
        await fetchDayCumulative(typeId: .activeEnergyBurned, unit: .kilocalorie(), date: date)
    }

    // MARK: - Basal Energy (Apple Watch)

    func fetchBasalEnergy(for date: Date) async -> Double {
        await fetchDayCumulative(typeId: .basalEnergyBurned, unit: .kilocalorie(), date: date)
    }

    // MARK: - Step Count

    func fetchStepCount(for date: Date) async -> Double {
        await fetchDayCumulative(typeId: .stepCount, unit: .count(), date: date)
    }

    // MARK: - Average Heart Rate

    func fetchAverageHeartRate(for date: Date) async -> Double? {
        let type = HKQuantityType(.heartRate)
        let predicate = dayPredicate(for: date)
        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .discreteAverage
            ) { _, stats, _ in
                let bpm = stats?.averageQuantity()?.doubleValue(for: HKUnit(from: "count/min"))
                continuation.resume(returning: bpm)
            }
            store.execute(query)
        }
    }

    // MARK: - Latest Body Weight

    func fetchLatestWeight() async -> Double? {
        let type = HKQuantityType(.bodyMass)
        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: nil,
                limit: 1,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
            ) { _, samples, _ in
                let kg = (samples?.first as? HKQuantitySample)?
                    .quantity.doubleValue(for: .gramUnit(with: .kilo))
                continuation.resume(returning: kg)
            }
            store.execute(query)
        }
    }

    // MARK: - Weight entries for last N days

    func fetchWeightEntries(days: Int = 14) async -> [WeightEntry] {
        let type = HKQuantityType(.bodyMass)
        let start = Calendar.current.date(byAdding: .day, value: -days, to: Date())!
        let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)

        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, samples, _ in
                let entries = (samples as? [HKQuantitySample] ?? []).map {
                    WeightEntry(date: $0.startDate, weightKg: $0.quantity.doubleValue(for: .gramUnit(with: .kilo)))
                }
                continuation.resume(returning: entries)
            }
            store.execute(query)
        }
    }

    // MARK: - Private helpers

    private func fetchDayCumulative(typeId: HKQuantityTypeIdentifier, unit: HKUnit, date: Date) async -> Double {
        let type = HKQuantityType(typeId)
        let predicate = dayPredicate(for: date)
        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, stats, _ in
                continuation.resume(returning: stats?.sumQuantity()?.doubleValue(for: unit) ?? 0)
            }
            store.execute(query)
        }
    }

    private func dayPredicate(for date: Date) -> NSPredicate {
        let start = Calendar.current.startOfDay(for: date)
        let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
        return HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
    }
}
