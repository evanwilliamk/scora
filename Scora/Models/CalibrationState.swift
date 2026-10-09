import Foundation

enum ConfidenceLevel: String, Codable {
    case high = "High"
    case medium = "Medium"
    case low = "Low"

    var explanation: String {
        switch self {
        case .high:   return "Recent weight data + consistent heart rate"
        case .medium: return "Some data missing — estimate may vary"
        case .low:    return "Keep tracking — not enough data yet"
        }
    }
}

struct WeightEntry: Codable, Identifiable {
    let id: UUID
    let date: Date
    let weightKg: Double

    init(date: Date, weightKg: Double) {
        self.id = UUID()
        self.date = date
        self.weightKg = weightKg
    }
}

struct CalibrationState: Codable {
    var multiplier: Double = 1.0
    var lastCalibrationDate: Date?
    var confidence: ConfidenceLevel = .low
    var weightEntries: [WeightEntry] = []

    var confidenceExplanation: String { confidence.explanation }
    var isClampedLow: Bool { multiplier <= 0.86 }
    var isClampedHigh: Bool { multiplier >= 1.14 }
}
