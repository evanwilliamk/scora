import Charts
import SwiftUI

// Inline chart-expansion (Plan tier, CLAUDE.md §3.4): a driver named in the
// read is tappable to the raw daily values behind it. The server finds the
// spans and sends the series; the app only draws them.

struct DriverLink: Decodable, Equatable {
  let start: Int // UTF-16 offsets into the read text
  let end: Int
  let key: String
}

struct SeriesPoint: Decodable, Equatable {
  let date: String // YYYY-MM-DD
  let value: Double
}

struct DriverSeries: Decodable, Identifiable, Equatable {
  let key: String
  let label: String
  let unit: String
  let points: [SeriesPoint]
  let baseline: Double?
  // How the API names the baseline ("last week" for load and volume).
  var baselineLabel: String? = nil

  var id: String { key }
  var latest: SeriesPoint? { points.last }

  // Load and volume are per-day totals (bars); body signals are a line.
  var isDailyTotal: Bool { key == "load" || key == "volume" }

  static func localDay(_ s: String, zone: TimeZone = .current) -> Date? {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = zone
    f.dateFormat = "yyyy-MM-dd"
    f.isLenient = false
    return f.date(from: s)
  }

  static func format(_ v: Double, unit: String) -> String {
    if unit == "h" {
      let mins = Int((v * 60).rounded())
      return "\(mins / 60):\(String(format: "%02d", mins % 60))"
    }
    let n = v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
    return "\(n) \(unit)"
  }
}

enum ReadText {
  static let scheme = "scora-chart"

  // The read with each linked span carrying a scora-chart://<key> link. Spans
  // that fall outside the text, overlap, or name no series are dropped, and
  // the text stays exactly as the server wrote it.
  static func attributed(_ voice: String, links: [DriverLink], series: [String: DriverSeries]) -> AttributedString {
    let ns = voice as NSString
    let out = NSMutableAttributedString(string: voice)
    var lastEnd = 0
    for l in links.sorted(by: { $0.start < $1.start }) {
      guard l.start >= lastEnd, l.end > l.start, l.end <= ns.length, series[l.key] != nil,
            let url = URL(string: "\(scheme)://\(l.key)") else { continue }
      out.addAttribute(.link, value: url, range: NSRange(location: l.start, length: l.end - l.start))
      lastEnd = l.end
    }
    return (try? AttributedString(out, including: \.foundation)) ?? AttributedString(voice)
  }

  static func seriesKey(_ url: URL) -> String? {
    url.scheme == scheme ? url.host : nil
  }
}

struct DriverChartView: View {
  let series: DriverSeries
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text(series.label).font(.headline.bold()).foregroundColor(.white)
        Spacer()
        Button("Done") { dismiss() }.foregroundColor(.orange)
      }
      if let latest = series.latest {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(DriverSeries.format(latest.value, unit: series.unit))
            .font(.system(size: 28, weight: .regular, design: .serif))
            .foregroundColor(.white)
          if let b = series.baseline {
            Text("\(series.baselineLabel ?? "average before"): \(DriverSeries.format(b, unit: series.unit))")
              .font(.footnote).foregroundColor(.gray)
          }
        }
      }
      Chart {
        ForEach(plotted, id: \.point.date) { item in
          let p = item.point
          let isLatest = p.date == series.latest?.date
          if series.isDailyTotal {
            BarMark(x: .value("Day", item.day, unit: .day), y: .value(series.unit, p.value))
              .foregroundStyle(isLatest ? Color.orange : Color(white: 0.45))
          } else {
            LineMark(x: .value("Day", item.day, unit: .day), y: .value(series.unit, p.value))
              .foregroundStyle(Color(white: 0.6))
            PointMark(x: .value("Day", item.day, unit: .day), y: .value(series.unit, p.value))
              .foregroundStyle(isLatest ? Color.orange : Color(white: 0.6))
          }
        }
        if let b = series.baseline {
          RuleMark(y: .value("Average", b))
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .foregroundStyle(Color(white: 0.5))
        }
      }
      .frame(height: 200)
      Text("Each point is a recorded value. Days with no reading are left out.")
        .font(.caption).foregroundColor(.gray)
      Spacer()
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
    .preferredColorScheme(.dark)
  }

  // Points the chart can place. Days are local calendar days, so they are
  // read in the local zone (Charts groups .day by the local calendar); a day
  // that does not parse is left out rather than drawn somewhere wrong.
  private var plotted: [(point: SeriesPoint, day: Date)] {
    series.points.compactMap { p in DriverSeries.localDay(p.date).map { (point: p, day: $0) } }
  }
}
