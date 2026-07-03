import SwiftUI

// MARK: - Models

struct DailyRead: Decodable {
  let voice: String
}

struct DashboardCard: Decodable, Identifiable {
  let id: String
  let title: String
  let available: Bool
  let value: String?
  let unit: String?
  let translation: String?
  let trend: String?
  let source: String?
  let cta: String?
}

struct ReadResponse: Decodable {
  let read: DailyRead
  let cards: [DashboardCard]
  let generatedAt: String?
}

// MARK: - View

struct DashboardView: View {
  @ObservedObject var tokenManager: TokenManager

  @State private var read: DailyRead?
  @State private var cards: [DashboardCard] = []
  @State private var isLoading = false
  @State private var errorText: String?
  @State private var expanded: Set<String> = []
  @State private var showChat = false

  private let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"

  private let columns = [
    GridItem(.flexible(), spacing: 12),
    GridItem(.flexible(), spacing: 12),
  ]

  var body: some View {
    VStack(spacing: 0) {
      header
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          todaysRead
          if !cards.isEmpty {
            LazyVGrid(columns: columns, spacing: 12) {
              ForEach(cards) { card in
                cardView(card)
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
      .refreshable { await loadRead() }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
    .sheet(isPresented: $showChat) {
      ChatView(tokenManager: tokenManager)
    }
    .task {
      if read == nil { await loadRead() }
    }
  }

  // MARK: Header

  private var header: some View {
    HStack {
      Text("SCORA")
        .font(.headline.bold())
        .foregroundColor(.white)
      Spacer()
      Button(action: { showChat = true }) {
        Image(systemName: "bubble.left.and.bubble.right")
          .foregroundColor(.orange)
      }
      Button("Sign Out") { tokenManager.logout() }
        .font(.subheadline)
        .foregroundColor(.orange)
        .padding(.leading, 8)
    }
    .padding()
    .background(Color.black)
  }

  // MARK: Today's Read

  private var todaysRead: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Today's Read")
        .font(.caption.bold())
        .foregroundColor(.gray)
        .textCase(.uppercase)

      if let read {
        Text(read.voice)
          .font(.system(size: 20, weight: .regular, design: .serif))
          .foregroundColor(.white)
          .fixedSize(horizontal: false, vertical: true)
      } else if isLoading {
        HStack(spacing: 10) {
          ProgressView().tint(.white)
          Text("Reading…").foregroundColor(.gray).font(.subheadline)
        }
        .padding(.vertical, 8)
      } else {
        Text("Pull to refresh your read.")
          .font(.subheadline)
          .foregroundColor(.gray)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.bottom, 4)
  }

  // MARK: Card

  @ViewBuilder
  private func cardView(_ card: DashboardCard) -> some View {
    let isOpen = expanded.contains(card.id)
    VStack(alignment: .leading, spacing: 8) {
      Text(card.title)
        .font(.caption.bold())
        .foregroundColor(.gray)

      if card.available, let value = card.value {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          Text(value)
            .font(.system(size: 30, weight: .semibold))
            .foregroundColor(.white)
          if let unit = card.unit {
            Text(unit)
              .font(.caption)
              .foregroundColor(.gray)
          }
        }
        if let trend = card.trend, !trend.isEmpty {
          Text(trend)
            .font(.caption)
            .foregroundColor(.orange)
        }
      } else {
        // Unavailable card: connect prompt, no fabricated number.
        Text(card.cta ?? "Not available yet.")
          .font(.footnote)
          .foregroundColor(.gray)
          .fixedSize(horizontal: false, vertical: true)
      }

      if isOpen, let translation = card.translation, !translation.isEmpty {
        Text(translation)
          .font(.footnote)
          .foregroundColor(Color(white: 0.75))
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 2)
      }

      if let source = card.source {
        Text(source)
          .font(.caption2)
          .foregroundColor(Color(white: 0.4))
          .padding(.top, 2)
      }
    }
    .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
    .padding(14)
    .background(Color(white: 0.11))
    .cornerRadius(12)
    .onTapGesture {
      guard card.available, card.translation != nil else { return }
      withAnimation(.easeInOut(duration: 0.15)) {
        if isOpen { expanded.remove(card.id) } else { expanded.insert(card.id) }
      }
    }
  }

  // MARK: Networking

  private func loadRead() async {
    guard let url = URL(string: "\(apiBase)/api/read") else { return }
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
      let decoded = try JSONDecoder().decode(ReadResponse.self, from: data)
      await MainActor.run {
        read = decoded.read
        cards = decoded.cards
        isLoading = false
      }
    } catch {
      await MainActor.run { errorText = error.localizedDescription; isLoading = false }
    }
  }
}
