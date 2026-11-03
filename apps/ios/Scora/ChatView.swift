import SwiftUI
@preconcurrency import WebKit

struct Driver: Identifiable, Decodable {
  var id = UUID()
  let metric: String
  let value: String
  let trend: String?
  
  enum CodingKeys: String, CodingKey { case metric, value, trend }

  init(metric: String, value: String, trend: String?) {
    self.metric = metric
    self.value = value
    self.trend = trend
  }

  // The value is text, but a number from the API still shows ("52", "7.5").
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    metric = try c.decode(String.self, forKey: .metric)
    if let s = try? c.decode(String.self, forKey: .value) {
      value = s
    } else if let n = try? c.decode(Double.self, forKey: .value) {
      value = n.rounded() == n && abs(n) < 1e15 ? String(Int(n)) : String(n)
    } else {
      value = ""
    }
    trend = try? c.decodeIfPresent(String.self, forKey: .trend)
  }
}

struct CDVResponse: Decodable {
  let voice: String
  let drivers: [Driver]
  let remaining: Int?
  let limit: Int?
  // Optional Vega-Lite spec for the answer's chart. Older API builds omit it.
  let chart: JSONValue?

  enum CodingKeys: String, CodingKey { case voice, drivers, remaining, limit, chart }

  // Only the voice is required: a missing driver list or a malformed count
  // leaves the answer readable instead of failing the whole reply.
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    voice = try c.decode(String.self, forKey: .voice)
    drivers = (try? c.decodeIfPresent([Driver].self, forKey: .drivers)) ?? []
    remaining = try? c.decodeIfPresent(Int.self, forKey: .remaining)
    limit = try? c.decodeIfPresent(Int.self, forKey: .limit)
    chart = try? c.decodeIfPresent(JSONValue.self, forKey: .chart)
  }
}

// A 200 reply as a chat bubble. A body that is not the expected shape (a
// proxy page, an empty voice) shows a fixed line, never a decoder message.
enum CDVReply {
  static let unreadable = "That answer came back unreadable. Try asking again."

  static func decode(_ data: Data) -> CDVResponse? {
    guard let r = try? JSONDecoder().decode(CDVResponse.self, from: data),
          !r.voice.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    return r
  }

  static func message(from data: Data) -> ChatMessage {
    guard let r = decode(data) else { return .error(unreadable) }
    let html = r.chart.flatMap(CDVChart.html(for:))
    return ChatMessage(isUser: false, text: r.voice, drivers: r.drivers, chartHTML: html,
                       chartSummary: html == nil ? nil : r.chart.flatMap(CDVChart.summary(for:)))
  }
}

enum ChatCopy {
  static let limitPlaceholder = "Daily limit reached. It resets tomorrow."
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

// Builds the WebView page for a CDV chart. The spec must carry its data
// inline: any key that fetches, links or runs an expression (url, href,
// usermeta, params, transform, signal...), an image mark, an expression other
// than a plain label format, or an oversized spec rejects the whole chart
// rather than drawing it.
enum CDVChart {
  static let blockedKeys: Set<String> = ["url", "href", "usermeta", "signals", "signal", "params",
                                         "transform", "calculate", "filter", "test", "expr"]
  static let maxSpecBytes = 32 * 1024
  // Names a label expression may use (the API's pace axis needs these).
  static let exprNames: Set<String> = ["datum", "value", "floor", "round", "slice", "abs"]

  static func isSafe(_ spec: JSONValue) -> Bool {
    switch spec {
    case .object(let o):
      return o.allSatisfy { key, value in
        let k = key.lowercased()
        if blockedKeys.contains(k) { return false }
        if k.hasSuffix("expr") {
          guard case .string(let e) = value else { return false }
          return isSimpleExpression(e)
        }
        if k == "mark" {
          if value == .string("image") { return false }
          if case .object(let m) = value, m["type"] == .string("image") { return false }
        }
        return isSafe(value)
      }
    case .array(let a):
      return a.allSatisfy(isSafe)
    default:
      return true
    }
  }

  // Arithmetic and string joins over datum.value only: no brackets, braces,
  // semicolons or escapes, and only names from `exprNames`.
  static func isSimpleExpression(_ e: String) -> Bool {
    guard e.count <= 200, e.range(of: #"[\[\]{};`\\]"#, options: .regularExpression) == nil else { return false }
    // Quoted literals become 0; a quote left over is an unterminated string.
    let unquoted = e.replacingOccurrences(of: #"'[^']*'|"[^"]*""#, with: " 0 ", options: .regularExpression)
    guard !unquoted.contains("'"), !unquoted.contains("\"") else { return false }
    let names = unquoted.components(separatedBy: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_$")).inverted)
      .filter { $0.first.map { !$0.isNumber } ?? false }
    return names.allSatisfy(exprNames.contains)
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

  // What VoiceOver reads for the chart: its own inline values, in the order
  // drawn, for a single-series x/y chart. Anything else (layers, folds,
  // aggregates) returns nil, and the label stays generic rather than guess.
  static func summary(for spec: JSONValue) -> String? {
    guard case .object(let o) = spec,
          case .object(let data)? = o["data"], case .array(let rows)? = data["values"],
          case .object(let enc)? = o["encoding"],
          case .object(let y)? = enc["y"], case .string(let yField)? = y["field"],
          y["aggregate"] == nil, enc["color"] == nil else { return nil }
    var xField: String?
    var xTitle: String?
    if case .object(let x)? = enc["x"], case .string(let f)? = x["field"] {
      xField = f
      if case .string(let t)? = x["title"] { xTitle = t } else { xTitle = f }
    }
    var ys: [Double] = []
    var xs: [String] = []
    for row in rows {
      guard case .object(let r) = row, case .number(let v)? = r[yField] else { continue }
      ys.append(v)
      if let xField, let x = r[xField] { xs.append(spoken(x)) }
    }
    guard let first = ys.first, let last = ys.last, let low = ys.min(), let high = ys.max() else { return nil }
    let yTitle: String
    if case .string(let t)? = y["title"] { yTitle = t } else { yTitle = yField }
    var parts = [xTitle.map { "\(yTitle) by \($0)" } ?? yTitle]
    var count = ys.count == 1 ? "1 value" : "\(ys.count) values"
    if ys.count > 1, xs.count == ys.count, let a = xs.first, let b = xs.last { count += ", from \(a) to \(b)" }
    parts.append(count)
    parts.append(ys.count == 1 ? "Value \(spoken(.number(first)))" : "First \(spoken(.number(first))), last \(spoken(.number(last)))")
    if ys.count > 1 { parts.append("Low \(spoken(.number(low))), high \(spoken(.number(high)))") }
    return parts.joined(separator: ". ") + "."
  }

  private static func spoken(_ v: JSONValue) -> String {
    switch v {
    case .number(let n): return n.rounded() == n && abs(n) < 1e15 ? String(Int(n)) : String(format: "%.1f", n)
    case .string(let s): return s
    case .bool(let b): return b ? "true" : "false"
    default: return ""
    }
  }

  // Page policy: scripts only from the pinned CDN files plus the one inline
  // script carrying `nonce`; no eval (Vega runs expressions through its
  // interpreter), no fetches, frames, forms or remote images.
  static func contentSecurityPolicy(nonce: String) -> String {
    "default-src 'none'; script-src https://cdn.jsdelivr.net/npm/ 'nonce-\(nonce)'; "
      + "style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; "
      + "media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; "
      + "form-action 'none'; base-uri 'none'"
  }

  // A fresh nonce per page.
  static func html(for spec: JSONValue) -> String? {
    html(for: spec, nonce: UUID().uuidString.replacingOccurrences(of: "-", with: ""))
  }

  static func html(for spec: JSONValue, nonce: String) -> String? {
    guard case .object = spec, isSafe(spec), let json = scriptJSON(spec),
          json.utf8.count <= maxSpecBytes else { return nil }
    return """
    <!doctype html>
    <html><head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="\(contentSecurityPolicy(nonce: nonce))">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>html,body{margin:0;height:100%;background:transparent;}#chart{width:100%;height:100%;}</style>
    <script src="https://cdn.jsdelivr.net/npm/vega@5.30.0"></script>
    <script src="https://cdn.jsdelivr.net/npm/vega-lite@5.21.0"></script>
    <script src="https://cdn.jsdelivr.net/npm/vega-interpreter@1.0.5"></script>
    <script src="https://cdn.jsdelivr.net/npm/vega-embed@6.26.0"></script>
    </head><body><div id="chart"></div>
    <script nonce="\(nonce)">
    var spec = \(json);
    spec.width = "container";
    // Fill the card and count axis labels, titles and the chart title inside
    // it; the default "pad" grows past the card's fixed height and clips them.
    spec.height = "container";
    spec.autosize = {type: "fit", contains: "padding"};
    spec.background = "transparent";
    spec.config = Object.assign({
      axis: {labelColor: "#999", titleColor: "#999", gridColor: "#333", domainColor: "#555"},
      legend: {labelColor: "#999", titleColor: "#999"},
      title: {color: "#fff"},
      view: {stroke: null},
      mark: {color: "#FF9500"},
      range: {category: ["#FF9500", "#8E8E93", "#FFFFFF"]}
    }, spec.config || {});
    vegaEmbed("#chart", spec, {actions: false, renderer: "svg", ast: true, expr: vega.expressionInterpreter}).then(function () {
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
    config.websiteDataStore = .nonPersistent() // no cookies or storage kept between charts
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

    private var loaded = false

    // Only the page itself loads: the first main-frame navigation to the
    // HTML string (about:blank). Script redirects, links and frames are cancelled.
    static func allows(url: URL?, isMainFrame: Bool, alreadyLoaded: Bool) -> Bool {
      !alreadyLoaded && isMainFrame && url?.absoluteString == "about:blank"
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
      let ok = Self.allows(url: action.request.url, isMainFrame: action.targetFrame?.isMainFrame ?? false,
                           alreadyLoaded: loaded)
      if ok { loaded = true }
      decisionHandler(ok ? .allow : .cancel)
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
  // Spoken summary of the chart's own values, when its shape allows one.
  var chartSummary: String? = nil
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

// A question that never reached the server (offline, timed out) says so in
// plain words and goes back in the box to send again, unless the athlete has
// already started typing another. It is not sent again on its own: a resend
// the athlete did not ask for would spend one of the day's questions.
enum CDVFailure {
  static func after(_ error: Error, question: String, input: String) -> (bubble: String, input: String) {
    let kept = input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? question : input
    return (NetworkText.chat.line(for: error), kept)
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
          .accessibilityAddTraits(.isHeader)
        Spacer()
        if let remaining {
          Text("\(max(0, remaining)) left today")
            .font(.caption)
            .foregroundColor(remaining == 0 ? .orange : .gray)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.trailing, 8)
        }
        Button(action: { tokenManager.logout() }) {
          Text("Sign Out").font(.subheadline).minTapTarget()
        }
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
        TextField(limitReached ? ChatCopy.limitPlaceholder : "Message", text: $input)
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
            .minTapTarget()
        }
        .disabled(input.isEmpty || isLoading || limitReached)
        .accessibilityLabel("Send")
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
            // The WebView's SVG has no spoken text, so the chart reads its own values.
            .accessibilityElement()
            .accessibilityLabel("Chart for this answer")
            .accessibilityValue(msg.chartSummary ?? "")
          if let card = msg.shareImage {
            ShareLink(item: ShareCard(image: card), preview: SharePreview("SCORA chart", image: Image(uiImage: card))) {
              Label("Share", systemImage: "square.and.arrow.up")
                .font(.caption.bold())
                .foregroundColor(.gray)
                .frame(minHeight: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Share this answer and chart")
          }
        }
        
        ForEach(msg.drivers) { d in
          // The value goes under the metric at large text sizes instead of clipping.
          ViewThatFits(in: .horizontal) {
            HStack {
              Text(d.metric).font(.caption.bold()).foregroundColor(.white)
              Spacer()
              driverValue(d)
            }
            VStack(alignment: .leading, spacing: 2) {
              Text(d.metric).font(.caption.bold()).foregroundColor(.white)
                .fixedSize(horizontal: false, vertical: true)
              HStack(alignment: .firstTextBaseline) { driverValue(d) }
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(Color(white: 0.1))
          .cornerRadius(8)
          .accessibilityElement(children: .combine)
        }
      }
    }
  }
  
  @ViewBuilder
  private func driverValue(_ d: Driver) -> some View {
    Text(d.value)
      .font(.caption)
      .foregroundColor(.orange)
    if let trend = d.trend, !trend.isEmpty {
      Text(trend)
        .font(.caption2)
        .foregroundColor(.gray)
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
      let (data, resp) = try await API.slowSession.data(for: req)
      
      if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
        // Prefer the server's `error` message (e.g. the daily-limit text);
        // fall back to the raw body only if it isn't the expected shape.
        let msg = APIErrorText.message(from: data, fallback: "That question could not be answered just now. Try again in a moment.")
        let isLimit = http.statusCode == 429
        await MainActor.run {
          messages.append(.error(msg))
          if isLimit { remaining = 0; limitReached = true }
          isLoading = false
        }
        return
      }

      let decoded = CDVReply.decode(data)
      await MainActor.run {
        messages.append(CDVReply.message(from: data))
        if let decoded {
          remaining = decoded.remaining
          limitReached = (decoded.remaining ?? 1) <= 0
        }
        isLoading = false
      }
    } catch {
      await MainActor.run {
        let failure = CDVFailure.after(error, question: message, input: input)
        messages.append(.error(failure.bubble))
        input = failure.input
        isLoading = false
      }
    }
  }
}
