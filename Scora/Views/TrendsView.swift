import SwiftUI
import Charts

struct TrendsView: View {
    @StateObject private var vm = TrendsViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    averageCard
                    chartCard
                    dailyList
                }
                .padding()
            }
            .navigationTitle("Trends")
            .task { await vm.refresh() }
            .refreshable { await vm.refresh() }
        }
    }

    // MARK: - Subviews

    private var averageCard: some View {
        VStack(spacing: 8) {
            Text("7-DAY AVERAGE")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .kerning(1.5)

            HStack(alignment: .top, spacing: 4) {
                Text(vm.sevenDayAverage > 0 ? "~\(vm.sevenDayAverage)" : "—")
                    .font(.system(size: 52, weight: .bold, design: .rounded))
                if vm.sevenDayAverage > 0 {
                    Text("cal/day")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.top, 14)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    @ViewBuilder
    private var chartCard: some View {
        if vm.weeklyRecords.isEmpty {
            ContentUnavailableView(
                "No data yet",
                systemImage: "chart.bar",
                description: Text("Come back after a full day of tracking.")
            )
        } else {
            VStack(alignment: .leading, spacing: 14) {
                Text("DAILY BURN")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .kerning(1.5)

                Chart {
                    ForEach(vm.weeklyRecords) { record in
                        BarMark(
                            x: .value("Day",      record.date, unit: .day),
                            y: .value("Calories", record.totalCalories)
                        )
                        .foregroundStyle(Color.orange.gradient)
                        .cornerRadius(6)
                    }
                    if vm.sevenDayAverage > 0 {
                        RuleMark(y: .value("Avg", Double(vm.sevenDayAverage)))
                            .foregroundStyle(Color.secondary.opacity(0.5))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [5]))
                            .annotation(position: .top, alignment: .leading) {
                                Text("avg")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                    }
                }
                .frame(height: 200)
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day)) { _ in
                        AxisValueLabel(format: .dateTime.weekday(.abbreviated))
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) { value in
                        AxisValueLabel {
                            if let cal = value.as(Double.self) {
                                Text(cal >= 1000 ? "\(Int(cal / 1000))k" : "\(Int(cal))")
                            }
                        }
                    }
                }
            }
            .padding(20)
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 20))
        }
    }

    private var dailyList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("DAILY LOG")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .kerning(1.5)

            ForEach(vm.weeklyRecords.reversed()) { record in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(record.date, format: .dateTime.weekday(.wide).month().day())
                            .font(.subheadline)
                            .fontWeight(.medium)
                        Text("Active \(Int(record.activeCalories)) · Resting \(Int(record.restingCalories))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("~\(Int(record.totalCalories))")
                        .font(.headline)
                        .fontWeight(.bold)
                        .foregroundStyle(.orange)
                }
                .padding(14)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
    }
}
