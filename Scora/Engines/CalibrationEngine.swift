import Foundation

struct CalibrationEngine {

    static let caloriesPerKg    = 7_700.0  // ≈ 3,500 cal/lb
    static let multiplierMin    = 0.85
    static let multiplierMax    = 1.15
    static let adjustmentStep   = 0.02     // move 2% per calibration
    static let noiseThreshold   = 0.3      // kg — ignore changes smaller than this

    // MARK: - Weekly calibration

    /// Compare actual weight change to what burn estimates implied and nudge
    /// the calibration multiplier accordingly.
    ///
    /// Core insight: if we think the user burned X calories above their intake
    /// they should have lost weight. If they didn't, we overestimated X.
    static func calibrate(
        currentState: CalibrationState,
        recentRecords: [DailyBurnRecord],
        weightEntries: [WeightEntry]
    ) -> CalibrationState {
        var state = currentState

        guard recentRecords.count >= 7, weightEntries.count >= 2 else {
            state.confidence = .low
            return state
        }

        let sorted = weightEntries.sorted { $0.date < $1.date }
        let firstKg = sorted.first!.weightKg
        let lastKg  = sorted.last!.weightKg
        let actualDeltaKg = lastKg - firstKg  // positive = gained

        // Positive delta → user gained → we overestimated burn → reduce multiplier
        // Negative delta → user lost   → we underestimated burn → increase multiplier
        if actualDeltaKg > noiseThreshold {
            state.multiplier -= adjustmentStep
        } else if actualDeltaKg < -noiseThreshold {
            state.multiplier += adjustmentStep
        }

        state.multiplier = min(multiplierMax, max(multiplierMin, state.multiplier))
        state.lastCalibrationDate = Date()

        let hasRecentHR   = recentRecords.count >= 7
        state.confidence  = computeConfidence(
            hasRecentWeight: true,
            hasConsistentHR: hasRecentHR,
            daysCovered: recentRecords.count
        )

        return state
    }

    // MARK: - Confidence score

    static func computeConfidence(
        hasRecentWeight: Bool,
        hasConsistentHR: Bool,
        daysCovered: Int
    ) -> ConfidenceLevel {
        if hasRecentWeight && hasConsistentHR && daysCovered >= 7 {
            return .high
        } else if hasRecentWeight || (hasConsistentHR && daysCovered >= 3) {
            return .medium
        } else {
            return .low
        }
    }

    // MARK: - Calibration scheduling

    static func daysSinceCalibration(_ state: CalibrationState) -> Int {
        guard let last = state.lastCalibrationDate else { return Int.max }
        return Calendar.current.dateComponents([.day], from: last, to: Date()).day ?? Int.max
    }

    static func needsCalibration(_ state: CalibrationState, minimumRecords: Int) -> Bool {
        guard minimumRecords >= 3 else { return false }  // need some history first
        return daysSinceCalibration(state) >= 7
    }
}
