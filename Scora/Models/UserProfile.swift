import Foundation

enum BiologicalSex: String, Codable, CaseIterable {
    case male = "Male"
    case female = "Female"
    case other = "Other"
}

struct UserProfile: Codable {
    var age: Int = 30
    var biologicalSex: BiologicalSex = .male
    var heightCm: Double = 175.0
    var weightKg: Double = 75.0
    var isOnboarded: Bool = false
}
