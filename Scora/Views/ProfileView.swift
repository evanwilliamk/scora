import SwiftUI

struct ProfileView: View {
    @ObservedObject var vm: HomeViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var age: String = ""
    @State private var heightCm: String = ""
    @State private var weightKg: String = ""
    @State private var selectedSex: BiologicalSex = .male

    private let persistence = PersistenceManager.shared

    var body: some View {
        NavigationStack {
            Form {
                Section("Body Stats") {
                    Picker("Biological Sex", selection: $selectedSex) {
                        ForEach(BiologicalSex.allCases, id: \.self) { sex in
                            Text(sex.rawValue).tag(sex)
                        }
                    }
                    row("Age", text: $age, suffix: "years")
                    row("Height", text: $heightCm, suffix: "cm")
                    row("Weight", text: $weightKg, suffix: "kg", decimal: true)
                }

                Section {
                    let bmr = EnergyCalculator.calculateBMR(profile: previewProfile)
                    HStack {
                        Text("Estimated BMR")
                        Spacer()
                        Text("\(Int(bmr.rounded())) cal/day")
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Preview")
                }
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .fontWeight(.semibold)
                }
            }
            .onAppear { loadCurrentProfile() }
        }
    }

    private var previewProfile: UserProfile {
        UserProfile(
            age: Int(age) ?? 30,
            biologicalSex: selectedSex,
            heightCm: Double(heightCm) ?? 175,
            weightKg: Double(weightKg) ?? 75
        )
    }

    @ViewBuilder
    private func row(_ label: String, text: Binding<String>, suffix: String, decimal: Bool = false) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("—", text: text)
                .keyboardType(decimal ? .decimalPad : .numberPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 60)
            Text(suffix).foregroundStyle(.secondary)
        }
    }

    private func loadCurrentProfile() {
        let profile  = persistence.loadProfile()
        age          = "\(profile.age)"
        heightCm     = String(format: "%.0f", profile.heightCm)
        weightKg     = String(format: "%.1f", profile.weightKg)
        selectedSex  = profile.biologicalSex
    }

    private func save() {
        var profile = persistence.loadProfile()
        profile.age           = Int(age)      ?? profile.age
        profile.heightCm      = Double(heightCm) ?? profile.heightCm
        profile.weightKg      = Double(weightKg) ?? profile.weightKg
        profile.biologicalSex = selectedSex
        vm.updateProfile(profile)
        dismiss()
    }
}
