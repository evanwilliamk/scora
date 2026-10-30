import SwiftUI
import UniformTypeIdentifiers

// MARK: - Models

struct WeeklyStat: Decodable, Identifiable {
  var id = UUID()
  let label: String
  let value: String
  let trend: String?

  init(label: String, value: String, trend: String?) {
    self.label = label
    self.value = value
    self.trend = trend
  }

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
  @State private var shareImage: UIImage?

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
        // PRD §5.A.5: the Sunday card can be forwarded (doc 10 2.1.6).
        if let shareImage {
          ShareLink(item: ShareCard(image: shareImage), preview: SharePreview("SCORA Sunday review", image: Image(uiImage: shareImage))) {
            Image(systemName: "square.and.arrow.up")
              .foregroundColor(.white)
          }
          .accessibilityLabel("Share this week's review")
        }
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
      #if DEBUG
      if let demo = DemoMode.weekly {
        read = demo.read
        stats = demo.stats
        shareImage = WeeklyShare.render(voice: demo.read.voice, stats: demo.stats)
        return
      }
      #endif
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
          .scaledSerif(19)
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
    // The local date, so "last night" and the week are the athlete's, not UTC's.
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["athleteId": tokenManager.athleteId, "today": PlanDay.today()])

    do {
      let (data, resp) = try await URLSession.shared.data(for: req)
      if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
        let msg = APIErrorText.message(from: data, fallback: "This week's review could not load. Try again in a moment.")
        await MainActor.run { errorText = msg; isLoading = false }
        return
      }
      let decoded = try JSONDecoder().decode(WeeklyResponse.self, from: data)
      await MainActor.run {
        read = decoded.read
        stats = decoded.stats
        shareImage = WeeklyShare.render(voice: decoded.read.voice, stats: decoded.stats)
        isLoading = false
      }
    } catch {
      await MainActor.run { errorText = error.localizedDescription; isLoading = false }
    }
  }
}

// MARK: - Share card

// The Sunday review as an image for the share sheet: the read and its numbers,
// nothing else about the athlete. Rendered on the phone (PRD §5.A.5 has it
// server-side; see DECISIONS.md 2026-10-28).
enum WeeklyShare {
  static let width: CGFloat = 360

  @MainActor
  static func render(voice: String, stats: [WeeklyStat], scale: CGFloat = 3) -> UIImage? {
    let renderer = ImageRenderer(content: WeeklyShareCard(voice: voice, stats: Array(stats.prefix(4))))
    renderer.scale = scale
    renderer.proposedSize = ProposedViewSize(width: width, height: nil)
    return renderer.uiImage
  }
}

struct WeeklyShareCard: View {
  let voice: String
  let stats: [WeeklyStat]

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("SUNDAY REVIEW")
        .font(.caption.bold())
        .foregroundColor(.gray)
      Text(voice)
        .font(.system(size: 19, weight: .regular, design: .serif))
        .foregroundColor(.white)
        .fixedSize(horizontal: false, vertical: true)
      if !stats.isEmpty {
        // Grid, not LazyVGrid: ImageRenderer does not reliably draw lazy containers.
        Grid(horizontalSpacing: 10, verticalSpacing: 10) {
          ForEach(Array(stride(from: 0, to: stats.count, by: 2)), id: \.self) { i in
            GridRow {
              tile(stats[i])
              if i + 1 < stats.count { tile(stats[i + 1]) } else { Color.clear }
            }
          }
        }
      }
      Text("SCORA")
        .font(.caption.bold())
        .tracking(2)
        .foregroundColor(.orange)
    }
    .padding(24)
    .frame(width: WeeklyShare.width, alignment: .leading)
    .background(Color.black)
    .environment(\.colorScheme, .dark)
  }

  private func tile(_ stat: WeeklyStat) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(stat.label).font(.caption2.bold()).foregroundColor(.gray)
      Text(stat.value).font(.system(size: 20, weight: .semibold)).foregroundColor(.white)
      if let trend = stat.trend, !trend.isEmpty {
        Text(trend).font(.caption2).foregroundColor(.orange)
      }
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .padding(10)
    .background(Color(white: 0.11))
    .cornerRadius(10)
  }
}

// A rendered card for ShareLink, exported as PNG data so every share target
// (Messages, WhatsApp, Mail, Save Image) receives an actual image file.
struct ShareCard: Transferable {
  let image: UIImage

  static var transferRepresentation: some TransferRepresentation {
    DataRepresentation(exportedContentType: .png) { card in
      card.image.pngData() ?? Data()
    }
  }
}
