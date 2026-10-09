import Foundation

struct ReadinessScore: Codable, Identifiable {
    let id: String
    let user_id: String
    let score_date: String
    let score: Int
    let label: String
    let recommendation: String
    let why: String
    let load_7d: Double?
    let intensity_yesterday: Double?
    let consecutive_hard_days: Int?

    var scoreColor: String {
        switch score {
        case 80...100: return "green"
        case 60...79:  return "orange"
        case 40...59:  return "red"
        default:       return "red"
        }
    }
}
