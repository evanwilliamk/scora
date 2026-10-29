import Foundation

// DEBUG only: launch with -demo-read to see the dashboard with a fixed sample
// read (no sign-in, no network), -demo-chart to open its HRV chart, and -demo-plan to open Your Plan. For
// checking UI on the simulator; release builds never contain it.
#if DEBUG
enum DemoMode {
  static var isOn: Bool { ProcessInfo.processInfo.arguments.contains("-demo-read") }
  static var opensChart: Bool { ProcessInfo.processInfo.arguments.contains("-demo-chart") }
  static var opensPlan: Bool { ProcessInfo.processInfo.arguments.contains("-demo-plan") }
  // -demo-plan-sessions: Your Plan shows two sample SCORA sessions (today
  // and tomorrow) with steps, so Send to Watch can be seen. Sample data only.
  static var planSessions: [PlanWorkout]? {
    guard ProcessInfo.processInfo.arguments.contains("-demo-plan-sessions") else { return nil }
    let today = PlanDay.today()
    let tomorrow = PlanDay.today(Date().addingTimeInterval(86_400))
    func step(_ type: String, _ min: Double, _ intensity: String) -> PlanStep {
      PlanStep(type: type, durationMin: min, intensity: intensity, reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)
    }
    var a = PlanWorkout(date: today, type: "run", intensity: "easy", durationMin: 40, distanceKm: nil, description: "40-minute easy run.")
    a.steps = [step("steady", 40, "easy")]
    var b = PlanWorkout(date: tomorrow, type: "run", intensity: "tempo", durationMin: 45, distanceKm: nil, description: "45-minute tempo. 10 minutes easy, 25 minutes at tempo, 10 minutes easy.")
    b.steps = [step("warmup", 10, "easy"), step("steady", 25, "tempo"), step("cooldown", 10, "easy")]
    return [a, b]
  }

  // -demo-weekly: This Week opens on its own with a sample Sunday review, so
  // the share button and card can be seen. Sample data only.
  static var opensWeekly: Bool { ProcessInfo.processInfo.arguments.contains("-demo-weekly") }
  static var weekly: (read: DailyRead, stats: [WeeklyStat])? {
    guard opensWeekly else { return nil }
    let read = DailyRead(
      voice: "Load came to 412 min across five runs, close to last week. The long run held at 95 min, and HRV finished the week at 52ms, above where it started.",
      links: nil, series: nil
    )
    return (read, [
      WeeklyStat(label: "LOAD", value: "412 min", trend: "+3% wk"),
      WeeklyStat(label: "RUNS", value: "5", trend: nil),
      WeeklyStat(label: "LONG RUN", value: "95 min", trend: nil),
      WeeklyStat(label: "HRV", value: "52ms", trend: "+8% wk"),
    ])
  }

  // -demo-chat: chat opens with a sample answer and its chart (drawn by
  // Vega-Lite from the CDN), so the share button can be seen. Sample data only.
  static var opensChat: Bool { ProcessInfo.processInfo.arguments.contains("-demo-chat") }
  static var chat: [ChatMessage]? {
    guard opensChat else { return nil }
    let values: [JSONValue] = [41, 44, 43, 47, 45, 46, 48, 52].enumerated().map { i, v in
      .object(["week": .number(Double(i + 1)), "hrv": .number(Double(v))])
    }
    let spec = JSONValue.object([
      "mark": .object(["type": .string("line"), "point": .bool(true)]),
      "data": .object(["values": .array(values)]),
      "encoding": .object([
        "x": .object(["field": .string("week"), "type": .string("ordinal"), "title": .string("Week")]),
        "y": .object(["field": .string("hrv"), "type": .string("quantitative"), "title": .string("HRV (ms)"), "scale": .object(["zero": .bool(false)])]),
      ]),
    ])
    return [
      ChatMessage(isUser: true, text: "How has my HRV moved over two months?", drivers: []),
      ChatMessage(isUser: false, text: "HRV rose from 41ms to 52ms over eight weeks, with one dip in week 3.", drivers: [], chartHTML: CDVChart.html(for: spec)),
    ]
  }

  // -demo-cards: the dashboard shows sample cards, including Plan today as
  // the API sends it when the athlete has a plan. Sample data only.
  static var cards: [DashboardCard]? {
    guard ProcessInfo.processInfo.arguments.contains("-demo-cards") else { return nil }
    return [
      DashboardCard(id: "sleep", title: "Sleep", available: true, value: "7:12", unit: "hrs", translation: "Slept 7:12 last night, Oura score 84.", trend: "Oura 84", source: "Oura", cta: nil),
      DashboardCard(id: "training_load", title: "Training Load", available: true, value: "412", unit: "min", translation: "412 min over 7 days, up 3% on the week before.", trend: "+3% wk", source: "Strava", cta: nil),
      DashboardCard(id: "plan_today", title: "Plan today", available: true, value: "45", unit: "min", translation: "On your plan today: tempo, 45 min.", trend: "tempo", source: "Your plan", cta: nil),
    ]
  }

  // -demo-plan-setup (with -demo-plan): the plan setup form opens with two
  // sample goals, as GET /api/plan/options would list them. Sample data only.
  static var planGoals: [PlanGoal]? {
    guard ProcessInfo.processInfo.arguments.contains("-demo-plan-setup") else { return nil }
    let json = #"{"goals":[{"sport":"run","goal_type":"half_marathon","label":"Half marathon","levels":[{"level":"first_timer","weekly_km":[15,30],"min_weeks":12},{"level":"regular","weekly_km":[30,50],"min_weeks":12}]},{"sport":"run","goal_type":"marathon","label":"Marathon","levels":[{"level":"regular","weekly_km":[45,70],"min_weeks":16}]}]}"#
    return try? JSONDecoder().decode(PlanOptionsResponse.self, from: Data(json.utf8)).goals
  }

  // With -demo-plan-sessions: Your Plan shows a sample block above the sessions.
  static var planBlock: PlanBlock? {
    guard planSessions != nil else { return nil }
    let json = #"{"goal":"Half marathon","week":4,"weeks":12,"race_date":"2026-12-27","phases":[{"name":"Base","first_week":1,"last_week":4,"focus":"aerobic development","current":true},{"name":"Build","first_week":5,"last_week":9,"focus":"threshold work","current":false},{"name":"Sharpen","first_week":10,"last_week":12,"focus":"race pace and taper","current":false}]}"#
    return try? JSONDecoder().decode(PlanBlock.self, from: Data(json.utf8))
  }

  static let week = WeekSoFar(
    days: zip(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], zip([40, 0, 80, 0, nil, nil, nil] as [Int?], [40, 0, 50, 45, 0, 100, 0])).enumerated().map { i, p in
      WeekSoFarDay(date: "2026-10-\(19 + i)", weekday: p.0, runMin: p.1.0, plannedMin: p.1.1)
    },
    line: "3 runs, 120 min since Monday; 95 min through Thursday last week. Plan: 135 min through Thursday."
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
