import SwiftUI

struct OnboardingView: View {
    @AppStorage("scora_isOnboarded") private var isOnboarded = false

    @State private var age: String = "30"
    @State private var heightCm: String = "175"
    @State private var weightKg: String = "75"
    @State private var selectedSex: BiologicalSex = .male
    @State private var isRequesting = false
    @State private var profileSaved = false

    private let hkManager   = HealthKitManager.shared
    private let persistence = PersistenceManager.shared
    @StateObject private var stravaAuth = StravaAuthManager.shared

    var body: some View {
        ScrollView {
            VStack(spacing: 32) {
                header

                if !profileSaved {
                    profileForm
                    healthKitInfo
                    saveProfileButton
                } else {
                    stravaConnectCard
                    skipButton
                }
            }
            .padding()
        }
        .animation(.easeInOut, value: profileSaved)
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 12) {
            Text("⚡")
                .font(.system(size: 64))
            Text("Welcome to Scora")
                .font(.largeTitle)
                .fontWeight(.bold)
            Text(profileSaved
                 ? "Connect Strava to get your first readiness score."
                 : "Get a personalized, self-improving estimate of your daily calorie burn.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 16)
    }

    // MARK: - Step 1: Profile

    private var profileForm: some View {
        VStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Biological Sex")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
                Picker("Sex", selection: $selectedSex) {
                    ForEach(BiologicalSex.allCases, id: \.self) { sex in
                        Text(sex.rawValue).tag(sex)
                    }
                }
                .pickerStyle(.segmented)
            }

            profileField("Age",    binding: $age,      placeholder: "30",  suffix: "years")
            profileField("Height", binding: $heightCm,  placeholder: "175", suffix: "cm")
            profileField("Weight", binding: $weightKg,  placeholder: "75",  suffix: "kg")
        }
        .padding(20)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var healthKitInfo: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "heart.fill")
                .foregroundStyle(.red)
                .font(.title3)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text("Apple Health Access")
                    .fontWeight(.medium)
                Text("Scora reads heart rate, steps, active energy, and body weight. Nothing is written back.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(20)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var saveProfileButton: some View {
        Button(action: saveProfile) {
            Group {
                if isRequesting {
                    ProgressView().tint(.white)
                } else {
                    Text("Continue")
                        .fontWeight(.semibold)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(16)
            .background(Color.orange)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .disabled(isRequesting)
    }

    // MARK: - Step 2: Strava Connect

    private var stravaConnectCard: some View {
        VStack(spacing: 20) {
            Image(systemName: "figure.run.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.orange)

            VStack(spacing: 6) {
                Text("Connect Strava")
                    .font(.title2)
                    .fontWeight(.bold)
                Text("Scora imports your workouts to calculate daily readiness and training load.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if let error = stravaAuth.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await stravaAuth.connect() }
            } label: {
                Group {
                    if stravaAuth.isLoading {
                        ProgressView().tint(.white)
                    } else if stravaAuth.isConnected {
                        Label("Connected", systemImage: "checkmark")
                            .fontWeight(.semibold)
                    } else {
                        Text("Connect Strava")
                            .fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(16)
                .background(stravaAuth.isConnected ? Color.green : Color.orange)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(stravaAuth.isLoading || stravaAuth.isConnected)

            if stravaAuth.isConnected {
                Button(action: finish) {
                    Text("Get Started")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(16)
                        .background(Color.orange)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }
        }
        .padding(24)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var skipButton: some View {
        Button("Skip for now") {
            finish()
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }

    // MARK: - Actions

    private func saveProfile() {
        let profile = UserProfile(
            age: Int(age) ?? 30,
            biologicalSex: selectedSex,
            heightCm: Double(heightCm) ?? 175,
            weightKg: Double(weightKg) ?? 75,
            isOnboarded: true
        )
        persistence.saveProfile(profile)
        isRequesting = true

        Task { @MainActor in
            await hkManager.requestAuthorization()
            isRequesting = false
            profileSaved = true
        }
    }

    private func finish() {
        isOnboarded = true
    }

    // MARK: - Helpers

    private func profileField(_ label: String, binding: Binding<String>, placeholder: String, suffix: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
            HStack {
                TextField(placeholder, text: binding)
                    .keyboardType(.numberPad)
                    .padding(12)
                    .background(Color(.systemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                Text(suffix).foregroundStyle(.secondary)
            }
        }
    }
}
