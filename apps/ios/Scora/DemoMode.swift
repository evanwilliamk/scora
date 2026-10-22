import Foundation

// DEBUG only: launch with -demo-read to see the dashboard with a fixed sample
// read (no sign-in, no network), -demo-chart to open its HRV chart, and -demo-plan to open Your Plan. For
// checking UI on the simulator; release builds never contain it.
#if DEBUG
enum DemoMode {
  static var isOn: Bool { ProcessInfo.processInfo.arguments.contains("-demo-read") }
  static var opensChart: Bool { ProcessInfo.processInfo.arguments.contains("-demo-chart") }
  static var opensPlan: Bool { ProcessInfo.processInfo.arguments.contains("-demo-plan") }

  static let week = WeekSoFar(
    days: zip(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [40, 0, 80, 0, nil, nil, nil] as [Int?]).enumerated().map { i, p in
      WeekSoFarDay(date: "2026-10-\(19 + i)", weekday: p.0, runMin: p.1)
    },
    line: "3 runs, 120 min since Monday; 95 min through Thursday last week."
  )

  static let read: DailyRead = {
    let voice = "Sleep held at 7:12 for the second night and HRV is 52ms, above your week. Load is 412 min, close to last week."
    let ns = voice as NSString
    func link(_ s: String, _ key: String) -> DriverLink {
      let r = ns.range(of: s)
      return DriverLink(start: r.location, end: r.location + r.length, key: key)
    }
    func days(_ values: [Double]) -> [SeriesPoint] {
      let f = DateFormatter()
      f.locale = Locale(identifier: "en_US_POSIX")
      f.timeZone = TimeZone(identifier: "UTC")
      f.dateFormat = "yyyy-MM-dd"
      let end = f.date(from: "2026-10-18")!
      return values.enumerated().map { i, v in
        SeriesPoint(date: f.string(from: end.addingTimeInterval(Double(i - values.count + 1) * 86400)), value: v)
      }
    }
    let hrv: [Double] = [41, 44, 43, 47, 45, 46, 44, 48, 46, 49, 47, 50, 48, 52]
    let sleep: [Double] = [6.8, 7.1, 6.5, 7.4, 6.9, 7.0, 6.2, 7.3, 7.5, 6.8, 7.0, 6.6, 7.1, 7.2]
    let load: [Double] = [355, 340, 362, 371, 348, 380, 392, 375, 388, 401, 396, 384, 405, 412]
    let mean = { (xs: [Double]) in (xs.dropLast().reduce(0, +) / Double(xs.count - 1) * 10).rounded() / 10 }
    return DailyRead(
      voice: voice,
      numbers: "Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412",
      links: [link("7:12", "sleep"), link("52ms", "hrv"), link("412 min", "load")],
      series: [
        "hrv": DriverSeries(key: "hrv", label: "HRV, nightly average", unit: "ms", points: days(hrv), baseline: mean(hrv)),
        "sleep": DriverSeries(key: "sleep", label: "Hours slept", unit: "h", points: days(sleep), baseline: mean(sleep)),
        "load": DriverSeries(key: "load", label: "Run minutes, last 7 days", unit: "min", points: days(load), baseline: mean(load)),
      ]
    )
  }()
}
#endif
