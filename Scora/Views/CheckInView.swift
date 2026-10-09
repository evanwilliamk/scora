import SwiftUI

struct CheckInView: View {
    @StateObject private var vm = CheckInViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    if vm.calibrationComplete {
                        calibrationResultCard
                    } else if vm.shouldShowCheckin {
                        checkInCard
                    } else {
                        upToDateCard
                    }
                    statusCard
                }
                .padding()
            }
            .navigationTitle("Check-In")
            .task { await vm.checkIfCheckinNeeded() }
        }
    }

    // MARK: - Cards

    private var checkInCard: some View {
        VStack(spacing: 20) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 48))
                .foregroundStyle(.orange)

            Text("Weekly Check-In")
                .font(.title2)
                .fontWeight(.bold)

            Text("Log your current weight to help Scora calibrate your calorie burn estimate.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            VStack(alignment: .leading, spacing: 6) {
                Text("Current weight")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)

                HStack {
                    TextField("e.g. 75.5", text: $vm.weightInput)
                        .keyboardType(.decimalPad)
                        .padding(12)
                        .background(Color(.systemGray5))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    Text("kg")
                        .foregroundStyle(.secondary)
                }
            }

            if vm.isLoading {
                ProgressView("Calibrating…").padding(.top, 4)
            } else {
                VStack(spacing: 12) {
                    Button {
                        Task { await vm.runCalibration() }
                    } label: {
                        Text("Run Calibration")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .padding(16)
                            .background(Color.orange)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }

                    Button("Remind me in 2 days") {
                        vm.snooze()
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(24)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var calibrationResultCard: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 52))
                .foregroundStyle(.green)

            Text("Calibration Complete")
                .font(.title2)
                .fontWeight(.bold)

            VStack(spacing: 6) {
                Text("New adjustment factor")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Text(String(format: "%.0f%%", vm.calibrationState.multiplier * 100))
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .foregroundStyle(.orange)

                Text(vm.calibrationState.confidenceExplanation)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(24)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var upToDateCard: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 52))
                .foregroundStyle(.green)

            Text("Up to Date")
                .font(.title2)
                .fontWeight(.bold)

            Text("Next calibration in \(vm.daysUntilNextCalibration) day\(vm.daysUntilNextCalibration == 1 ? "" : "s").")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("CALIBRATION STATUS")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .kerning(1.5)

            VStack(spacing: 12) {
                statusRow("Adjustment Factor",
                          value: String(format: "%.0f%%", vm.calibrationState.multiplier * 100))
                statusRow("Confidence",
                          value: vm.calibrationState.confidence.rawValue)
                if let last = vm.calibrationState.lastCalibrationDate {
                    statusRow("Last Calibration",
                              value: last.formatted(.dateTime.month().day()))
                }
                statusRow("Weight Entries",
                          value: "\(vm.calibrationState.weightEntries.count)")
            }
        }
        .padding(20)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func statusRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).fontWeight(.medium)
        }
        .font(.subheadline)
    }
}
