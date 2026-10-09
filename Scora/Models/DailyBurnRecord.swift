import Foundation

struct DailyBurnRecord: Codable, Identifiable {
    var id: String { dateString }
    let date: Date
    let restingCalories: Double
    let activeCalories: Double
    let calibrationMultiplier: Double

    var dateString: String {
        DateFormatter.dayKey.string(from: date)
    }

    var totalCalories: Double {
        (restingCalories + activeCalories) * calibrationMultiplier
    }

    var rawTotal: Double {
        restingCalories + activeCalories
    }
}
