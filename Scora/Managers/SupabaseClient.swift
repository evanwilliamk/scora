import Foundation

struct SupabaseClient {
    static let shared = SupabaseClient()

    private let baseURL = "https://ukrrhqjphkavwnfgekeu.supabase.co"
    private let anonKey = "REPLACE_WITH_SUPABASE_PUBLISHABLE_KEY"

    private var userID: String? {
        UserDefaults.standard.string(forKey: "scora_user_id")
    }

    // MARK: - Fetch today's readiness score

    func fetchTodayReadiness() async -> ReadinessScore? {
        guard let userID else { return nil }
        let today = DateFormatter.dayKey.string(from: Date())
        guard let url = URL(string: "\(baseURL)/rest/v1/readiness_scores?user_id=eq.\(userID)&score_date=eq.\(today)&limit=1") else { return nil }

        var request = URLRequest(url: url)
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        guard
            let (data, _) = try? await URLSession.shared.data(for: request),
            let scores = try? JSONDecoder().decode([ReadinessScore].self, from: data)
        else { return nil }

        return scores.first
    }

    // MARK: - Fetch last N readiness scores

    func fetchRecentReadiness(days: Int = 7) async -> [ReadinessScore] {
        guard let userID else { return [] }
        guard let url = URL(string: "\(baseURL)/rest/v1/readiness_scores?user_id=eq.\(userID)&order=score_date.desc&limit=\(days)") else { return [] }

        var request = URLRequest(url: url)
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        guard
            let (data, _) = try? await URLSession.shared.data(for: request),
            let scores = try? JSONDecoder().decode([ReadinessScore].self, from: data)
        else { return [] }

        return scores
    }

    // MARK: - Trigger nightly score for this user (on-demand after onboarding)

    func triggerScoreComputation() async {
        guard let url = URL(string: "\(baseURL)/functions/v1/nightly-score") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        _ = try? await URLSession.shared.data(for: request)
    }
}
