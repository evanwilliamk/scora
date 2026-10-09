import SwiftUI

struct HomeView: View {
    @StateObject private var vm = HomeViewModel()
    @State private var showingProfile = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    readinessCard
                    if vm.readiness != nil { whyCard }
                    calorieCard
                    if vm.usedMockData { mockDataBanner }
                }
                .padding()
            }
            .navigationTitle("Scora")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showingProfile = true } label: {
                        Image(systemName: "person.circle").font(.title3)
                    }
                }
            }
            .refreshable { await vm.refresh() }
            .task { await vm.refresh() }
            .sheet(isPresented: $showingProfile) {
                ProfileView(vm: vm)
            }
        }
    }

    // MARK: - Readiness card (primary)

    private var readinessCard: some View {
        VStack(spacing: 12) {
            Text("TODAY'S READINESS")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .kerning(1.5)

            if vm.isLoading {
                ProgressView().scaleEffect(1.5).frame(height: 80)
            } else if let r = vm.readiness {
                HStack(alignment: .top, spacing: 4) {
                    Text("\(r.score)")
                        .font(.system(size: 80, weight: .bold, design: .rounded))
                        .foregroundStyle(scoreColor(r.score))
                    Text("/ 100")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .padding(.top, 20)
                }

                Text(r.label)
                    .font(.title3)
                    .fontWeight(.semibold)

                Text(r.recommendation)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 36))
                        .foregroundStyle(.secondary)
                    Text("Score computing…")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("Connect Strava and check back tomorrow morning.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
                .frame(height: 120)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    // MARK: - Why card

    private var whyCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "lightbulb.fill")
                .foregroundStyle(.orange)
                .font(.title3)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text("Why")
                    .fontWeight(.semibold)
                Text(vm.readiness?.why ?? "")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - Calorie card (secondary)

    private var calorieCard: some View {
        VStack(spacing: 16) {
            Text("TODAY'S BURN")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .kerning(1.5)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 14) {
                burnTile(title: "Resting", value: vm.restingCalories, icon: "bed.double.fill", color: .blue)
                burnTile(title: "Active",  value: vm.activeCalories,  icon: "flame.fill",      color: .orange)
                burnTile(title: "Total",   value: vm.totalCalories,   icon: "sum",              color: .purple)
            }

            if vm.calibrationMultiplier != 1.0 {
                HStack(spacing: 6) {
                    Image(systemName: "slider.horizontal.3").font(.caption2).foregroundStyle(.secondary)
                    Text("Calibration: \(String(format: "%.0f%%", vm.calibrationMultiplier * 100))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(20)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func burnTile(title: String, value: Int, icon: String, color: Color) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.title2).foregroundStyle(color)
            Text("\(value)").font(.title2).fontWeight(.bold)
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(14)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var mockDataBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "info.circle.fill").foregroundStyle(.orange)
            Text("Estimated data — connect Apple Health for accuracy")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func scoreColor(_ score: Int) -> Color {
        switch score {
        case 80...100: return .green
        case 60...79:  return .orange
        default:       return .red
        }
    }
}
