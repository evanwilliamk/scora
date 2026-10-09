import Foundation

struct EnergyCalculator {

    // MARK: - BMR: Mifflin-St Jeor equation
    // Result is kcal/day at complete rest

    static func calculateBMR(profile: UserProfile) -> Double {
        let sexOffset: Double
        switch profile.biologicalSex {
        case .male:   sexOffset = 5
        case .female: sexOffset = -161
        case .other:  sexOffset = -78  // midpoint
        }
        // BMR = (10 × kg) + (6.25 × cm) − (5 × age) + offset
        return (10 * profile.weightKg) + (6.25 * profile.heightCm) - (5 * Double(profile.age)) + sexOffset
    }

    // Daily resting energy = BMR (already expressed per day)
    static func dailyRestingEnergy(profile: UserProfile) -> Double {
        calculateBMR(profile: profile)
    }

    // MARK: - Total burn with calibration applied

    static func totalBurn(resting: Double, active: Double, calibrationMultiplier: Double) -> Double {
        (resting + active) * calibrationMultiplier
    }

    // MARK: - Mock fallback when HealthKit is unavailable

    // ~0.04 kcal/step is a reasonable population average
    static func mockActiveEnergy(steps: Double = 8_000) -> Double {
        steps * 0.04
    }

    // MARK: - Heart-rate–based active energy estimate (optional refinement)
    // Used when HealthKit active energy is missing but HR is available.
    // Simple proxy: fraction of BMR scaled by HR elevation above rest.

    static func estimateActiveEnergyFromHR(avgHeartRate: Double, profile: UserProfile) -> Double {
        let restingHR = 65.0
        guard avgHeartRate > restingHR else { return mockActiveEnergy() }
        let elevation = (avgHeartRate - restingHR) / restingHR
        return calculateBMR(profile: profile) * elevation * 0.5
    }
}
