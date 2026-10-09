import Foundation

@MainActor
class TrendsViewModel: ObservableObject {
    @Published var weeklyRecords: [DailyBurnRecord] = []
    @Published var sevenDayAverage: Int = 0

    private let persistence = PersistenceManager.shared
    private let hkManager   = HealthKitManager.shared

    func refresh() async {
        let cutoff = Calendar.current.date(byAdding: .day, value: -7, to: Date())!
        weeklyRecords = persistence.loadDailyRecords()
            .filter { $0.date >= cutoff }
            .sorted { $0.date < $1.date }

        // Backfill missing days from HealthKit if authorized
        if weeklyRecords.count < 7 && hkManager.isAuthorized {
            await backfillMissingDays()
        }

        if !weeklyRecords.isEmpty {
            let avg = weeklyRecords.reduce(0.0) { $0 + $1.totalCalories } / Double(weeklyRecords.count)
            sevenDayAverage = Int(avg.rounded())
        }
    }

    private func backfillMissingDays() async {
        let profile     = persistence.loadProfile()
        let calibration = persistence.loadCalibration()
        let existing    = Set(weeklyRecords.map(\.dateString))

        for offset in stride(from: 6, through: 0, by: -1) {
            let date    = Calendar.current.date(byAdding: .day, value: -offset, to: Date())!
            let dateStr = DateFormatter.dayKey.string(from: date)
            guard !existing.contains(dateStr) else { continue }

            let active  = await hkManager.fetchActiveEnergy(for: date)
            let resting = EnergyCalculator.dailyRestingEnergy(profile: profile)

            let record = DailyBurnRecord(
                date: date,
                restingCalories: resting,
                activeCalories: active > 0 ? active : EnergyCalculator.mockActiveEnergy(),
                calibrationMultiplier: calibration.multiplier
            )
            weeklyRecords.append(record)
            persistence.saveDailyRecord(record)
        }
        weeklyRecords.sort { $0.date < $1.date }
    }
}
