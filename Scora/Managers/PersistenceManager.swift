import Foundation

class PersistenceManager {
    static let shared = PersistenceManager()

    private let defaults = UserDefaults.standard
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private enum Keys {
        static let userProfile = "scora_user_profile"
        static let calibrationState = "scora_calibration_state"
        static let dailyRecords = "scora_daily_records"
    }

    // MARK: - User Profile

    func saveProfile(_ profile: UserProfile) {
        if let data = try? encoder.encode(profile) {
            defaults.set(data, forKey: Keys.userProfile)
        }
    }

    func loadProfile() -> UserProfile {
        guard let data = defaults.data(forKey: Keys.userProfile),
              let profile = try? decoder.decode(UserProfile.self, from: data) else {
            return UserProfile()
        }
        return profile
    }

    // MARK: - Calibration State

    func saveCalibration(_ state: CalibrationState) {
        if let data = try? encoder.encode(state) {
            defaults.set(data, forKey: Keys.calibrationState)
        }
    }

    func loadCalibration() -> CalibrationState {
        guard let data = defaults.data(forKey: Keys.calibrationState),
              let state = try? decoder.decode(CalibrationState.self, from: data) else {
            return CalibrationState()
        }
        return state
    }

    // MARK: - Daily Records

    func saveDailyRecord(_ record: DailyBurnRecord) {
        var records = loadDailyRecords()
        records.removeAll { $0.dateString == record.dateString }
        records.append(record)
        // Keep last 90 days
        records = records.sorted { $0.date < $1.date }.suffix(90).map { $0 }
        if let data = try? encoder.encode(records) {
            defaults.set(data, forKey: Keys.dailyRecords)
        }
    }

    func loadDailyRecords() -> [DailyBurnRecord] {
        guard let data = defaults.data(forKey: Keys.dailyRecords),
              let records = try? decoder.decode([DailyBurnRecord].self, from: data) else {
            return []
        }
        return records
    }
}
