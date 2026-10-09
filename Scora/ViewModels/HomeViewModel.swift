import Foundation
import SwiftUI

@MainActor
class HomeViewModel: ObservableObject {
    @Published var readiness: ReadinessScore?
    @Published var todayRecord: DailyBurnRecord?
    @Published var calibrationState: CalibrationState
    @Published var isLoading = false
    @Published var usedMockData = false

    private let hkManager   = HealthKitManager.shared
    private let persistence = PersistenceManager.shared
    private let supabase    = SupabaseClient.shared
    private var profile: UserProfile

    init() {
        self.profile          = PersistenceManager.shared.loadProfile()
        self.calibrationState = PersistenceManager.shared.loadCalibration()
    }

    // MARK: - Computed display values

    var totalCalories: Int   { Int((todayRecord?.totalCalories ?? 0).rounded()) }
    var restingCalories: Int { Int((todayRecord?.restingCalories ?? 0).rounded()) }
    var activeCalories: Int  { Int((todayRecord?.activeCalories ?? 0).rounded()) }
    var calibrationMultiplier: Double { calibrationState.multiplier }
    var confidence: ConfidenceLevel   { calibrationState.confidence }

    // MARK: - Data loading

    func refresh() async {
        isLoading = true
        profile          = persistence.loadProfile()
        calibrationState = persistence.loadCalibration()

        async let readinessTask = supabase.fetchTodayReadiness()
        async let healthTask: () = loadHealthData()

        let (score, _) = await (readinessTask, healthTask)
        readiness = score
        isLoading = false
    }

    private func loadHealthData() async {
        if hkManager.isAuthorized {
            await loadFromHealthKit(date: Date())
        } else {
            loadMockData()
        }
    }

    private func loadFromHealthKit(date: Date) async {
        async let activeTask = hkManager.fetchActiveEnergy(for: date)
        async let basalTask  = hkManager.fetchBasalEnergy(for: date)
        async let hrTask     = hkManager.fetchAverageHeartRate(for: date)

        let (active, basal, hr) = await (activeTask, basalTask, hrTask)

        let resting: Double = basal > 100
            ? basal
            : EnergyCalculator.dailyRestingEnergy(profile: profile)

        let activeEnergy: Double
        if active > 10 {
            activeEnergy = active
        } else if let hr {
            activeEnergy = EnergyCalculator.estimateActiveEnergyFromHR(avgHeartRate: hr, profile: profile)
        } else {
            activeEnergy = EnergyCalculator.mockActiveEnergy()
        }

        let record = DailyBurnRecord(
            date: date,
            restingCalories: resting,
            activeCalories: activeEnergy,
            calibrationMultiplier: calibrationState.multiplier
        )
        todayRecord  = record
        usedMockData = active <= 10
        persistence.saveDailyRecord(record)
    }

    private func loadMockData() {
        todayRecord = DailyBurnRecord(
            date: Date(),
            restingCalories: EnergyCalculator.dailyRestingEnergy(profile: profile),
            activeCalories:  EnergyCalculator.mockActiveEnergy(),
            calibrationMultiplier: calibrationState.multiplier
        )
        usedMockData = true
    }

    func updateProfile(_ newProfile: UserProfile) {
        profile = newProfile
        persistence.saveProfile(newProfile)
    }
}
