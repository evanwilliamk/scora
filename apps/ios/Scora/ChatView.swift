import SwiftUI

struct Driver: Identifiable, Decodable {
  var id = UUID()
  let metric: String
  let value: String
  let trend: String?
  
  enum CodingKeys: String, CodingKey { case metric, value, trend }
}

struct CDVResponse: Decodable {
  let voice: String
  let drivers: [Driver]
  let remaining: Int?
  let limit: Int?
}

// Error body from /api/cdv (e.g. the 429 daily-limit message).
struct CDVError: Decodable {
  let error: String
}

struct ChatMessage: Identifiable {
  let id = UUID()
  let isUser: Bool
  let text: String
  let drivers: [Driver]
}

struct ChatView: View {
  @ObservedObject var tokenManager: TokenManager
  @State private var messages: [ChatMessage] = []
  @State private var input: String = ""
  @State private var isLoading = false
  @State private var remaining: Int?
  @State private var limitReached = false

  private let apiBase = "https://zonal-prosperity-production-3965.up.railway.app"
  
  var body: some View {
    VStack(spacing: 0) {
      // Header
      HStack {
        Text("SCORA")
          .font(.headline.bold())
          .foregroundColor(.white)
        Spacer()
        if let remaining {
          Text("\(remaining) left today")
            .font(.caption)
            .foregroundColor(remaining == 0 ? .orange : .gray)
            .padding(.trailing, 8)
        }
        Button("Sign Out") { tokenManager.logout() }
          .font(.subheadline)
          .foregroundColor(.orange)
      }
      .padding()
      .background(Color.black)
      
      // Messages
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 16) {
            if messages.isEmpty {
              Text("Ask about your training.\ne.g. \"How am I trending this week?\"")
                .font(.subheadline)
                .foregroundColor(.gray)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 60)
            }
            ForEach(messages) { msg in
              messageBubble(msg)
                .id(msg.id)
            }
            if isLoading {
              HStack {
                ProgressView().tint(.white)
                Text("Reading…").foregroundColor(.gray).font(.subheadline)
              }
              .padding(.horizontal)
            }
          }
          .padding()
        }
        .onChange(of: messages.count) { _ in
          if let last = messages.last {
            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
          }
        }
      }
      
      // Input
      HStack(spacing: 12) {
        TextField(limitReached ? "Daily limit reached — resets tomorrow" : "Message", text: $input)
          .padding(12)
          .background(Color(white: 0.15))
          .foregroundColor(.white)
          .cornerRadius(20)
          .onSubmit(send)
          .disabled(limitReached)

        Button(action: send) {
          Image(systemName: "arrow.up.circle.fill")
            .font(.system(size: 32))
            .foregroundColor(input.isEmpty || limitReached ? .gray : .orange)
        }
        .disabled(input.isEmpty || isLoading || limitReached)
      }
      .padding()
      .background(Color.black)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
  }
  
  @ViewBuilder
  private func messageBubble(_ msg: ChatMessage) -> some View {
    if msg.isUser {
      HStack {
        Spacer()
        Text(msg.text)
          .padding(12)
          .background(Color.orange)
          .foregroundColor(.white)
          .cornerRadius(16)
      }
    } else {
      VStack(alignment: .leading, spacing: 10) {
        Text(msg.text)
          .foregroundColor(.white)
          .padding(12)
          .background(Color(white: 0.15))
          .cornerRadius(16)
        
        ForEach(msg.drivers) { d in
          HStack {
            Text(d.metric)
              .font(.caption.bold())
              .foregroundColor(.white)
            Spacer()
            Text(d.value)
              .font(.caption)
              .foregroundColor(.orange)
            if let trend = d.trend, !trend.isEmpty {
              Text(trend)
                .font(.caption2)
                .foregroundColor(.gray)
            }
          }
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(Color(white: 0.1))
          .cornerRadius(8)
        }
      }
    }
  }
  
  private func send() {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !isLoading else { return }
    
    messages.append(ChatMessage(isUser: true, text: text, drivers: []))
    input = ""
    isLoading = true
    
    Task {
      await callCDV(message: text)
    }
  }
  
  private func callCDV(message: String) async {
    guard let url = URL(string: "\(apiBase)/api/cdv") else { return }
    
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    
    let body: [String: String] = [
      "message": message,
      "stravaToken": tokenManager.stravaToken,
      "athleteId": tokenManager.athleteId
    ]
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    
    do {
      let (data, resp) = try await URLSession.shared.data(for: req)
      
      if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
        // Prefer the server's `error` message (e.g. the daily-limit text);
        // fall back to the raw body only if it isn't the expected shape.
        let msg = (try? JSONDecoder().decode(CDVError.self, from: data))?.error
          ?? String(data: data, encoding: .utf8) ?? "Unknown error"
        let isLimit = http.statusCode == 429
        await MainActor.run {
          messages.append(ChatMessage(isUser: false, text: msg, drivers: []))
          if isLimit { remaining = 0; limitReached = true }
          isLoading = false
        }
        return
      }

      let decoded = try JSONDecoder().decode(CDVResponse.self, from: data)
      await MainActor.run {
        messages.append(ChatMessage(isUser: false, text: decoded.voice, drivers: decoded.drivers))
        remaining = decoded.remaining
        limitReached = (decoded.remaining ?? 1) <= 0
        isLoading = false
      }
    } catch {
      await MainActor.run {
        messages.append(ChatMessage(isUser: false, text: "⚠️ \(error.localizedDescription)", drivers: []))
        isLoading = false
      }
    }
  }
}
