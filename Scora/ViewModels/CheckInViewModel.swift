import Foundation

@MainActor
class CheckInViewModel: ObservableObject {
    @Published var calibrationState: CalibrationState
    @Published var weightInput: String = ""
    @Published var calibrationComplete = false
    @Published var isLoading = false
    @Published var shouldShowCheckin = false

    private let persistence = PersistenceManager.shared
    private let hkManager   = HealthKitManager.shared

    init() {
        self.calibrationState = PersistenceManager.shared.loadCalibration()
    }

    func checkIfCheckinNeeded() async {
        calibrationState = persistence.loadCalibration()
        let records = persistence.loadDailyRecords()

        // Pre-populate weight from HealthKit if available
        if hkManager.isAuthorized, let kg = await hkManager.fetchLatestWeight() {
            weightInput = String(format: "%.1f", kg)
        }

        shouldShowCheckin = CalibrationEngine.needsCalibration(
            calibrationState,
            minimumRecords: records.count
        )
    }

    func runCalibration() async {
        isLoading = true
        let records = persistence.loadDailyRecords()
        var weightEntries = calibrationState.weightEntries

        // Add manual entry if user typed one in
        if let kg = Double(weightInput), kg > 0 {
            weightEntries.append(WeightEntry(date: Date(), weightKg: kg))
        }

        // Supplement with HealthKit weight history
        if hkManager.isAuthorized {
            let hkWeights = await hkManager.fetchWeightEntries(days: 14)
            weightEntries.append(contentsOf: hkWeights)
        }

        // Deduplicate: keep one entry per day (latest wins)
        var byDay: [String: WeightEntry] = [:]
        for entry in weightEntries {
            byDay[DateFormatter.dayKey.string(from: entry.date)] = entry
        }
        weightEntries = byDay.values.sorted { $0.date < $1.date }

        var newState = CalibrationEngine.calibrate(
            currentState: calibrationState,
            recentRecords: records,
            weightEntries: weightEntries
        )
        newState.weightEntries = weightEntries

        calibrationState = newState
        persistence.saveCalibration(newState)

        isLoading = false
        calibrationComplete = true
        shouldShowCheckin = false
    }

    func snooze() {
        // Snooze by pretending calibration ran 5 days ago → prompts again in 2 days
        var state = calibrationState
        state.lastCalibrationDate = Calendar.current.date(byAdding: .day, value: -5, to: Date())
        calibrationState = state
        persistence.saveCalibration(state)
        shouldShowCheckin = false
    }

    var daysUntilNextCalibration: Int {
        max(0, 7 - CalibrationEngine.daysSinceCalibration(calibrationState))
    }
}
