import SwiftUI
@preconcurrency import WebKit

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
  // Optional Vega-Lite spec for the answer's chart. Older API builds omit it.
  let chart: JSONValue?
}

// Arbitrary JSON, so a Vega-Lite spec can pass through Codable untouched.
enum JSONValue: Codable, Equatable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let b = try? c.decode(Bool.self) { self = .bool(b) }
    else if let n = try? c.decode(Double.self) { self = .number(n) }
    else if let s = try? c.decode(String.self) { self = .string(s) }
    else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
    else { self = .object(try c.decode([String: JSONValue].self)) }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let s): try c.encode(s)
    case .number(let n): try c.encode(n)
    case .bool(let b): try c.encode(b)
    case .object(let o): try c.encode(o)
    case .array(let a): try c.encode(a)
    case .null: try c.encodeNil()
    }
  }
}

// Builds the WebView page for a CDV chart. The spec comes from an LLM, so it
// must carry its data inline: any `url` or `href` key (external data, image
// marks, link channels) rejects the whole chart rather than fetching anything.
enum CDVChart {
  static let blockedKeys: Set<String> = ["url", "href"]

  static func isSafe(_ spec: JSONValue) -> Bool {
    switch spec {
    case .object(let o):
      return o.allSatisfy { !blockedKeys.contains($0.key.lowercased()) && isSafe($0.value) }
    case .array(let a):
      return a.allSatisfy(isSafe)
    default:
      return true
    }
  }

  // Spec JSON safe to inline inside a <script> tag.
  static func scriptJSON(_ spec: JSONValue) -> String? {
    guard let data = try? JSONEncoder().encode(spec),
          let json = String(data: data, encoding: .utf8) else { return nil }
    return json
      .replacingOccurrences(of: "<", with: "\\u003c")
      .replacingOccurrences(of: ">", with: "\\u003e")
      .replacingOccurrences(of: "&", with: "\\u0026")
  }

  static func html(for spec: JSONValue) -> String? {
    guard case .object = spec, isSafe(spec), let json = scriptJSON(spec) else { return nil }
    return """
    <!doctype html>
    <html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>html,body{margin:0;background:transparent;}#chart{width:100%;}</style>
    <script src="https://cdn.jsdelivr.net/npm/vega@5.30.0"></script>
    <script src="https://cdn.jsdelivr.net/npm/vega-lite@5.21.0"></script>
    <script src="https://cdn.jsdelivr.net/npm/vega-embed@6.26.0"></script>
    </head><body><div id="chart"></div>
    <script>
    var spec = \(json);
    spec.width = "container";
    spec.background = "transparent";
    spec.config = Object.assign({
      axis: {labelColor: "#999", titleColor: "#999", gridColor: "#333", domainColor: "#555"},
      legend: {labelColor: "#999", titleColor: "#999"},
      title: {color: "#fff"},
      view: {stroke: null},
      mark: {color: "#FF9500"},
      range: {category: ["#FF9500", "#8E8E93", "#FFFFFF"]}
    }, spec.config || {});
    vegaEmbed("#chart", spec, {actions: false, renderer: "svg"}).then(function () {
      // Tells the app the chart is drawn, so it can snapshot it for sharing.
      setTimeout(function () {
        try { window.webkit.messageHandlers.rendered.postMessage(1); } catch (e) {}
      }, 50);
    });
    </script>
    </body></html>
    """
  }
}

// WebView host for a CDV chart. Static: no links, no navigation after load.
// Once the chart is drawn the page posts "rendered" and the view hands a
// snapshot to `onRendered` (for the share card).
struct CDVChartView: UIViewRepresentable {
  let html: String
  var onRendered: ((UIImage) -> Void)? = nil

  func makeCoordinator() -> Coordinator { Coordinator(onRendered: onRendered) }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.userContentController.add(context.coordinator, name: "rendered")
    let web = WKWebView(frame: .zero, configuration: config)
    web.isOpaque = false
    web.backgroundColor = .clear
    web.scrollView.isScrollEnabled = false
    web.navigationDelegate = context.coordinator
    web.loadHTMLString(html, baseURL: nil)
    return web
  }

  func updateUIView(_ web: WKWebView, context: Context) {}

  static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
    web.configuration.userContentController.removeScriptMessageHandler(forName: "rendered")
  }

  final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let onRendered: ((UIImage) -> Void)?
    private var done = false

    init(onRendered: ((UIImage) -> Void)?) { self.onRendered = onRendered }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
      decisionHandler(action.navigationType == .other ? .allow : .cancel)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      guard !done, let onRendered, let web = message.webView else { return }
      done = true
      web.takeSnapshot(with: nil) { image, _ in
        if let image { onRendered(image) }
      }
    }
  }
}

// A CDV answer and its chart as one image for the share sheet (CLAUDE.md §7).
enum CDVShare {
  @MainActor
  static func render(text: String, chart: UIImage, scale: CGFloat = 3) -> UIImage? {
    let renderer = ImageRenderer(content: CDVShareCard(text: text, chart: chart))
    renderer.scale = scale
    renderer.proposedSize = ProposedViewSize(width: WeeklyShare.width, height: nil)
    return renderer.uiImage
  }
}

struct CDVShareCard: View {
  let text: String
  let chart: UIImage

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text)
        .font(.system(size: 17))
        .foregroundColor(.white)
        .fixedSize(horizontal: false, vertical: true)
      Image(uiImage: chart)
        .resizable()
        .scaledToFit()
        .background(Color(white: 0.1))
        .cornerRadius(10)
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
  var chartHTML: String? = nil
  // The answer and its drawn chart as one image, once the chart has rendered.
  var shareImage: UIImage? = nil
}

extension ChatMessage {
  /// A non-user bubble for a failed request. Plain text only: no emoji or
  /// warning glyphs in anything SCORA renders (CLAUDE.md §3.7).
  static func error(_ text: String) -> ChatMessage {
    ChatMessage(isUser: false, text: text, drivers: [])
  }
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
      #if DEBUG
      .task { if messages.isEmpty, let demo = DemoMode.chat { messages = demo } }
      #endif
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
        .onChange(of: messages.count) {
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

        if let html = msg.chartHTML {
          CDVChartView(html: html) { chart in
            DispatchQueue.main.async {
              guard let i = messages.firstIndex(where: { $0.id == msg.id }) else { return }
              messages[i].shareImage = CDVShare.render(text: msg.text, chart: chart)
            }
          }
            .frame(height: 220)
            .background(Color(white: 0.1))
            .cornerRadius(12)
          if let card = msg.shareImage {
            let image = Image(uiImage: card)
            ShareLink(item: image, preview: SharePreview("SCORA chart", image: image)) {
              Label("Share", systemImage: "square.and.arrow.up")
                .font(.caption.bold())
                .foregroundColor(.gray)
            }
          }
        }
        
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
      "athleteId": tokenManager.athleteId,
      // The daily query count resets at the athlete's own midnight.
      "today": PlanDay.today()
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
          messages.append(.error(msg))
          if isLimit { remaining = 0; limitReached = true }
          isLoading = false
        }
        return
      }

      let decoded = try JSONDecoder().decode(CDVResponse.self, from: data)
      await MainActor.run {
        messages.append(ChatMessage(
          isUser: false,
          text: decoded.voice,
          drivers: decoded.drivers,
          chartHTML: decoded.chart.flatMap(CDVChart.html(for:))
        ))
        remaining = decoded.remaining
        limitReached = (decoded.remaining ?? 1) <= 0
        isLoading = false
      }
    } catch {
      await MainActor.run {
        messages.append(.error(error.localizedDescription))
        isLoading = false
      }
    }
  }
}
