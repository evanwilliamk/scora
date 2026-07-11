import SwiftUI

// MARK: - Models

struct WeeklyStat: Decodable, Identifiable {
  var id = UUID()
  let label: String
  let value: String
  let trend: String?

  enum CodingKeys: String, CodingKey { case label, value, trend }
}

struct WeeklyResponse: Decodable {
  let read: DailyRead
  let stats: [WeeklyStat]
  let generatedAt: String?
}

// MARK: - View

struct WeeklyView: View {
  @ObservedObject var tokenManager: TokenManager

  @State private var read: DailyRead?
  @State private var stats: [WeeklyStat] = []
  @State private var isLoading = false
  @State private var errorText: String?

  private let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"

  private let columns = [
    GridItem(.flexible(), spacing: 12),
    GridItem(.flexible(), spacing: 12),
  ]

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("This Week")
          .font(.headline.bold())
          .foregroundColor(.white)
        Spacer()
      }
      .padding()
      .background(Color.black)

      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          weeklyRead
          if !stats.isEmpty {
            LazyVGrid(columns: columns, spacing: 12) {
              ForEach(stats) { stat in
                statTile(stat)
              }
            }
          }
          if let errorText, read == nil {
            Text(errorText)
              .font(.subheadline)
              .foregroundColor(.gray)
              .frame(maxWidth: .infinity, alignment: .center)
              .padding(.top, 40)
          }
        }
        .padding()
      }
      .refreshable { await loadWeekly() }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
    .task {
      if read == nil { await loadWeekly() }
    }
  }

  private var weeklyRead: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("SUNDAY REVIEW")
        .font(.caption.bold())
        .foregroundColor(.gray)

      if let read {
        Text(read.voice)
          .font(.system(size: 19, weight: .regular, design: .serif))
          .foregroundColor(.white)
          .fixedSize(horizontal: false, vertical: true)
      } else if isLoading {
        HStack(spacing: 10) {
          ProgressView().tint(.white)
          Text("Reading the week…").foregroundColor(.gray).font(.subheadline)
        }
        .padding(.vertical, 8)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func statTile(_ stat: WeeklyStat) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(stat.label)
        .font(.caption.bold())
        .foregroundColor(.gray)
      Text(stat.value)
        .font(.system(size: 24, weight: .semibold))
        .foregroundColor(.white)
      if let trend = stat.trend, !trend.isEmpty {
        Text(trend)
          .font(.caption)
          .foregroundColor(.orange)
      }
    }
    .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
    .padding(14)
    .background(Color(white: 0.11))
    .cornerRadius(12)
  }

  private func loadWeekly() async {
    guard let url = URL(string: "\(apiBase)/api/weekly") else { return }
    await MainActor.run { isLoading = true; errorText = nil }

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["athleteId": tokenManager.athleteId])

    do {
      let (data, resp) = try await URLSession.shared.data(for: req)
      if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
        let msg = String(data: data, encoding: .utf8) ?? "Unknown error"
        await MainActor.run { errorText = msg; isLoading = false }
        return
      }
      let decoded = try JSONDecoder().decode(WeeklyResponse.self, from: data)
      await MainActor.run {
        read = decoded.read
        stats = decoded.stats
        isLoading = false
      }
    } catch {
      await MainActor.run { errorText = error.localizedDescription; isLoading = false }
    }
  }
}
