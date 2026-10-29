//
//  ScoraTests.swift
//  ScoraTests
//
//  Created by everett kosowski on 7/2/26.
//

import XCTest
import WorkoutKit
@testable import Scora

final class ScoraTests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    func testExample() throws {
        // This is an example of a functional test case.
        // Use XCTAssert and related functions to verify your tests produce the correct results.
        // Any test you write for XCTest can be annotated as throws and async.
        // Mark your test throws to produce an unexpected failure when your test encounters an uncaught error.
        // Mark your test async to allow awaiting for asynchronous code to complete. Check the results with assertions afterwards.
    }

    func testErrorBubbleIsPlainText() throws {
        let message = ChatMessage.error("The network connection was lost.")
        XCTAssertFalse(message.isUser)
        XCTAssertTrue(message.drivers.isEmpty)
        XCTAssertEqual(message.text, "The network connection was lost.")
        let hasGlyph = message.text.unicodeScalars.contains {
            $0.properties.isEmojiPresentation || $0.value == 0x26A0
        }
        XCTAssertFalse(hasGlyph, "error bubbles carry no emoji (CLAUDE.md 3.7)")
    }

    func testPerformanceExample() throws {
        // This is an example of a performance test case.
        self.measure {
            // Put the code you want to measure the time of here.
        }
    }

    // MARK: - Card expansion

    func testCardExpansionDecodes() throws {
        let json = #"{"cardId":"sleep","reply":"Sleep 7:12 held for a second night.","drivers":[],"generated":true}"#
        let e = try JSONDecoder().decode(CardExpansion.self, from: Data(json.utf8))
        XCTAssertEqual(e.cardId, "sleep")
        XCTAssertEqual(e.generated, true)
    }

    func testStaleExpansionIsDropped() {
        XCTAssertTrue(CardExpansion.isCurrent(requested: 3, current: 3))
        XCTAssertFalse(CardExpansion.isCurrent(requested: 2, current: 3))
    }

    func testCardExpansionFallsBackToTranslation() {
        XCTAssertEqual(CardExpansion.text(reply: "Read.", translation: "Card."), "Read.")
        XCTAssertEqual(CardExpansion.text(reply: nil, translation: "Card."), "Card.")
        XCTAssertEqual(CardExpansion.text(reply: "  ", translation: "Card."), "Card.")
        XCTAssertNil(CardExpansion.text(reply: nil, translation: ""))
    }

    // MARK: - Oura deep link

    func testOuraSuccessLink() throws {
        let r = try XCTUnwrap(OuraLinkResult(url: URL(string: "scora://oura/success")!))
        XCTAssertTrue(r.connected)
    }

    func testOuraFailedLinkReadsReason() throws {
        let cancelled = try XCTUnwrap(OuraLinkResult(url: URL(string: "scora://oura/failed?reason=cancelled")!))
        XCTAssertFalse(cancelled.connected)
        XCTAssertTrue(cancelled.message.contains("was not connected"))
        let other = try XCTUnwrap(OuraLinkResult(url: URL(string: "scora://oura/failed?reason=exchange")!))
        XCTAssertTrue(other.message.contains("Nothing changed"))
    }

    func testOtherLinksAreNotOuraResults() {
        XCTAssertNil(OuraLinkResult(url: URL(string: "scora://auth/success?athlete_id=1")!))
        XCTAssertNil(OuraLinkResult(url: URL(string: "https://oura/success")!))
        XCTAssertNil(OuraLinkResult(url: URL(string: "scora://oura/elsewhere")!))
    }

    func testOuraBannerCopyHasNoExclamationOrEmoji() throws {
        for link in ["scora://oura/success", "scora://oura/failed?reason=cancelled", "scora://oura/failed"] {
            let m = try XCTUnwrap(OuraLinkResult(url: URL(string: link)!)).message
            XCTAssertFalse(m.contains("!"))
            XCTAssertFalse(m.unicodeScalars.contains { $0.properties.isEmojiPresentation })
        }
    }

    // MARK: - Manual plan

    func testPlanWorkoutDecodesBothShapes() throws {
        let parsed = try JSONDecoder().decode(PlanSaveResponse.self, from: Data(#"{"planId":"p","workouts":[{"date":"2026-10-20","type":"run","intensity":"tempo","duration_min":45,"distance_km":null,"description":"45 min tempo"}],"rejected":["duration 60 min is not in the text"]}"#.utf8))
        XCTAssertEqual(parsed.workouts.first?.durationMin, 45)
        XCTAssertEqual(parsed.rejected.count, 1)

        let stored = try JSONDecoder().decode(PlanListResponse.self, from: Data(#"{"today":"2026-10-17","workouts":[{"id":"w","scheduled_date":"2026-10-18","planned_type":"run","planned_intensity":"long","planned_duration_min":null,"planned_distance_km":25.75,"planned_description":"long run 16 mi easy"}]}"#.utf8))
        let w = try XCTUnwrap(stored.workouts.first)
        XCTAssertEqual(w.date, "2026-10-18")
        XCTAssertEqual(w.intensity, "long")
        XCTAssertEqual(w.distanceKm, 25.75)
    }

    func testPlanWorkoutLabels() {
        let w = PlanWorkout(date: "2026-10-20", type: "run", intensity: "tempo", durationMin: 45, distanceKm: 8, description: nil)
        XCTAssertEqual(w.dayLabel, "Tue Oct 20")
        XCTAssertEqual(w.detail, "tempo · 45 min · 8 km")
        let ride = PlanWorkout(date: "2026-10-24", type: "ride", intensity: nil, durationMin: nil, distanceKm: 25.75, description: nil)
        XCTAssertEqual(ride.detail, "ride · 25.8 km")
    }

    func testPlanTodayUsesTheGivenZone() {
        let instant = Date(timeIntervalSince1970: 1_792_195_200) // 2026-10-17 00:00 UTC
        XCTAssertEqual(PlanDay.today(instant, zone: TimeZone(identifier: "UTC")!), "2026-10-17")
        XCTAssertEqual(PlanDay.today(instant, zone: TimeZone(identifier: "America/Los_Angeles")!), "2026-10-16")
    }

    func testPlanAdaptationsDecodeAndShowNewestThree() throws {
        let json = """
        {"adaptations":[
          {"id":"a","adaptation_type":"downgraded","original_date":null,"new_date":null,"reason_code":"posture_backoff_tempo_scheduled","reason_text":"Thursday's tempo is now an endurance run at the same 40 minutes. Today's posture reads back-off.","triggered_at":"2026-10-28T06:00:00.000Z"},
          {"id":"b","adaptation_type":"moved","original_date":"2026-11-03","new_date":"2026-11-05","reason_code":"posture_rest_hard_scheduled","reason_text":"Tuesday's threshold session moved to Thursday.","triggered_at":"2026-11-02T06:00:00.000Z"},
          {"id":"c","adaptation_type":"skipped","original_date":"2026-11-05","new_date":null,"reason_code":"displaced_by_move","reason_text":"Thursday's easy run gives way to Tuesday's threshold session.","triggered_at":"2026-11-02T06:00:00.000Z"},
          {"id":"d","adaptation_type":"moved","original_date":"2026-10-20","new_date":"2026-10-22","reason_code":"posture_rest_hard_scheduled","reason_text":"Older.","triggered_at":"2026-10-19T06:00:00.000Z"},
          {"id":"e","adaptation_type":"moved","original_date":"2026-10-13","new_date":"2026-10-15","reason_code":"posture_rest_hard_scheduled","reason_text":"Oldest.","triggered_at":"2026-10-12T06:00:00.000Z"}
        ]}
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(PlanAdaptationsResponse.self, from: json)
        XCTAssertEqual(decoded.adaptations.count, 5)
        XCTAssertEqual(PlanChanges.visible(decoded.adaptations).map(\.id), ["b", "a", "d"])
    }

    func testReadWithInlineChartsDecodesAndLinksSpans() throws {
        let json = """
        {"read":{"voice":"It’s settled: sleep held at 7:12 and HRV is 52ms.",
          "links":[{"start":28,"end":32,"key":"sleep"},{"start":44,"end":48,"key":"hrv"},{"start":0,"end":4,"key":"load"},{"start":40,"end":99,"key":"hrv"}],
          "series":{"sleep":{"key":"sleep","label":"Hours slept","unit":"h","points":[{"date":"2026-10-17","value":6.5},{"date":"2026-10-18","value":7.2}],"baseline":6.5},
                    "hrv":{"key":"hrv","label":"HRV","unit":"ms","points":[{"date":"2026-10-17","value":44},{"date":"2026-10-18","value":52}],"baseline":44}}},
         "cards":[],"generatedAt":null}
        """.data(using: .utf8)!
        let r = try JSONDecoder().decode(ReadResponse.self, from: json)
        let text = ReadText.attributed(r.read.voice, links: r.read.links ?? [], series: r.read.series ?? [:])
        XCTAssertEqual(String(text.characters), r.read.voice, "the text is unchanged")
        var linked: [String: String] = [:]
        for run in text.runs {
            if let url = run.link, let key = ReadText.seriesKey(url) { linked[key] = String(text[run.range].characters) }
        }
        // load has no series and the out-of-range span is dropped.
        XCTAssertEqual(linked, ["sleep": "7:12", "hrv": "52ms"])
        XCTAssertEqual(DriverSeries.format(7.2, unit: "h"), "7:12")
        XCTAssertEqual(DriverSeries.format(52, unit: "ms"), "52 ms")
    }

    func testLastNightSleepIsTodaysGroupedNightOnly() {
        let nights = [HealthNight(day: "2026-10-27", sleepSeconds: 26000), HealthNight(day: "2026-10-28", sleepSeconds: 25920)]
        XCTAssertEqual(HealthNights.lastNightSleep(nights, today: "2026-10-28"), 25920)
        XCTAssertNil(HealthNights.lastNightSleep(nights, today: "2026-10-29"), "no night ending today, no last night")
    }

    func testWeekAverageHRVUsesTheSevenNightsBeforeTheNewest() {
        let nights = [
            HealthNight(day: "2026-10-01", hrvMs: 10), // weeks old: out
            HealthNight(day: "2026-10-22", hrvMs: 40),
            HealthNight(day: "2026-10-26", hrvMs: 50),
            HealthNight(day: "2026-10-28", hrvMs: 90), // the newest: compared, not averaged
        ]
        XCTAssertEqual(HealthNights.weekAverageHRV(nights), 45)
        XCTAssertNil(HealthNights.weekAverageHRV([HealthNight(day: "2026-10-28", hrvMs: 90)]))
        // A newest night without HRV: the latest HRV night is compared, not averaged.
        XCTAssertEqual(HealthNights.weekAverageHRV(nights + [HealthNight(day: "2026-10-29", sleepSeconds: 25000)]), 45)
    }

    func testAPIErrorTextNeverShowsARawBody() {
        XCTAssertEqual(APIErrorText.message(from: Data(#"{"error":"You've used your 3 chats for today."}"#.utf8), fallback: "x"), "You've used your 3 chats for today.")
        XCTAssertEqual(APIErrorText.message(from: Data("<html>502 Bad Gateway</html>".utf8), fallback: "fallback"), "fallback")
        XCTAssertEqual(APIErrorText.message(from: Data(#"{"statusCode":500,"message":"boom"}"#.utf8), fallback: "fallback"), "fallback")
    }

    func testPlanChangeDayIsTheLocalDay() {
        let la = TimeZone(identifier: "America/Los_Angeles")!
        // 03:00 UTC on the 29th is 8 pm on the 28th in Los Angeles.
        XCTAssertEqual(PlanChanges.day("2026-10-29T03:00:00.000Z", zone: la), "Oct 28")
        XCTAssertEqual(PlanChanges.day("2026-10-29T03:00:00Z", zone: la), "Oct 28")
    }

    func testTimeZoneSyncOnlyAfterAZoneWasSent() {
        TimeZoneSync.forget()
        XCTAssertTrue(TimeZoneSync.needsSync(current: "Europe/London"), "none recorded: sent once")
        TimeZoneSync.remember("America/New_York")
        XCTAssertTrue(TimeZoneSync.needsSync(current: "Europe/London"))
        XCTAssertFalse(TimeZoneSync.needsSync(current: "America/New_York"))
        TimeZoneSync.forget()
    }

    func testSeriesBaselineLabelDecodesWhenSent() throws {
        let json = """
        {"load":{"key":"load","label":"Run minutes, last 7 days","unit":"min","points":[{"date":"2026-10-18","value":110}],"baseline":98,"baselineLabel":"last week"},
         "hrv":{"key":"hrv","label":"HRV","unit":"ms","points":[{"date":"2026-10-18","value":52}],"baseline":44}}
        """.data(using: .utf8)!
        let s = try JSONDecoder().decode([String: DriverSeries].self, from: json)
        XCTAssertEqual(s["load"]?.baselineLabel, "last week")
        XCTAssertNil(s["hrv"]?.baselineLabel, "absent means the app's own 'average before'")
    }

    func testChartDaysAreLocalAndImpossibleDaysAreDropped() {
        let ny = TimeZone(identifier: "America/New_York")!
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = ny
        let d = DriverSeries.localDay("2026-10-18", zone: ny)!
        XCTAssertEqual(cal.component(.day, from: d), 18, "a US local day stays on its own date")
        XCTAssertNil(DriverSeries.localDay("2026-02-31"))
        XCTAssertNil(DriverSeries.localDay("soon"))
    }

    func testReadDecodesNumbersAndPosture() throws {
        let json = #"{"read":{"voice":"Body is settled.","numbers":"Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412"},"posture":{"posture":"steady","rule":"default"},"cards":[],"generatedAt":null}"#
        let r = try JSONDecoder().decode(ReadResponse.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(r.read.numbers, "Sleep 7:12 · Oura 84 · HRV 52ms (+8% wk) · Load 412")
        XCTAssertEqual(r.posture?.posture, "steady")
    }

    func testWeekSoFarDecodesAndScalesBars() throws {
        let json = #"{"read":{"voice":"x"},"weekSoFar":{"days":[{"date":"2026-10-19","weekday":"Mon","run_min":40},{"date":"2026-10-20","weekday":"Tue","run_min":0},{"date":"2026-10-21","weekday":"Wed","run_min":80},{"date":"2026-10-22","weekday":"Thu","run_min":null}],"runs":2,"total_min":120,"last_week_to_date_min":95,"line":"2 runs, 120 min since Monday; 95 min by this point last week."},"cards":[],"generatedAt":null}"#
        let r = try JSONDecoder().decode(ReadResponse.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(r.weekSoFar?.heights, [0.5, 0, 1, nil])
        XCTAssertEqual(r.weekSoFar?.line, "2 runs, 120 min since Monday; 95 min by this point last week.")
    }

    func testWeekSoFarPlannedOutlineSharesTheScale() throws {
        let json = #"{"days":[{"date":"2026-10-19","weekday":"Mon","run_min":40,"planned_min":40},{"date":"2026-10-20","weekday":"Tue","run_min":0,"planned_min":80},{"date":"2026-10-21","weekday":"Wed","run_min":null,"planned_min":0}],"line":"x"}"#
        let w = try JSONDecoder().decode(WeekSoFar.self, from: Data(json.utf8))
        XCTAssertEqual(w.heights, [0.5, 0, nil])
        XCTAssertEqual(w.plannedHeights, [0.5, 1, 0])
        let noPlan = try JSONDecoder().decode(WeekSoFar.self, from: Data(#"{"days":[{"date":"2026-10-19","weekday":"Mon","run_min":40}],"line":"x"}"#.utf8))
        XCTAssertEqual(noPlan.plannedHeights, [nil])
    }

    func testReadWithoutChartsStillDecodes() throws {
        let json = #"{"read":{"voice":"Plain read."},"cards":[],"generatedAt":null}"#.data(using: .utf8)!
        let r = try JSONDecoder().decode(ReadResponse.self, from: json)
        XCTAssertNil(r.read.links)
        XCTAssertEqual(String(ReadText.attributed(r.read.voice, links: [], series: [:]).characters), "Plain read.")
    }

    func testHealthNightsGroupByWakeDayAndAverage() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York")!
        func at(_ s: String) -> Date {
            let f = ISO8601DateFormatter()
            return f.date(from: s)!
        }
        let nights = HealthNights.group(
            // 23:00 to 06:30 local (two pieces), waking on the 18th
            sleep: [(start: at("2026-10-18T03:00:00Z"), end: at("2026-10-18T07:00:00Z")),
                    (start: at("2026-10-18T07:30:00Z"), end: at("2026-10-18T10:30:00Z"))],
            hrv: [(date: at("2026-10-18T10:00:00Z"), value: 50), (date: at("2026-10-18T11:00:00Z"), value: 54),
                  (date: at("2026-10-17T11:00:00Z"), value: 44)],
            restingHr: [(date: at("2026-10-18T12:00:00Z"), value: 48.4)],
            calendar: cal)
        XCTAssertEqual(nights, [
            HealthNight(day: "2026-10-17", sleepSeconds: nil, hrvMs: 44, restingHr: nil),
            HealthNight(day: "2026-10-18", sleepSeconds: 7 * 3600, hrvMs: 54, restingHr: 48),
        ])
    }

    func testHealthNightsCountOverlapsOnceAndIgnoreNaps() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York")!
        let f = ISO8601DateFormatter()
        let at = { (s: String) in f.date(from: s)! }
        let nights = HealthNights.group(
            sleep: [
                // Watch and iPhone both log the same night: 03:00-10:00Z, overlapping.
                (start: at("2026-10-18T03:00:00Z"), end: at("2026-10-18T09:00:00Z")),
                (start: at("2026-10-18T04:00:00Z"), end: at("2026-10-18T10:00:00Z")),
                // A 40 minute afternoon nap the same day.
                (start: at("2026-10-18T19:00:00Z"), end: at("2026-10-18T19:40:00Z")),
            ],
            hrv: [], restingHr: [], calendar: cal)
        XCTAssertEqual(nights, [HealthNight(day: "2026-10-18", sleepSeconds: 7 * 3600, hrvMs: nil, restingHr: nil)])
    }

    func testRacePredictionReadsAsARangeWithItsBasis() throws {
        let ok = #"{"prediction":{"ok":true,"race":"half_marathon","distance_m":21097.5,"low_s":6300,"high_s":6720,"efforts":[{"date":"2026-10-04"},{"date":"2026-10-11"},{"date":"2026-10-14"}],"used_races":false,"version":"prediction-v1.0.0"}}"#
        let p = try JSONDecoder().decode(PredictionResponse.self, from: ok.data(using: .utf8)!).prediction
        XCTAssertEqual(p.headline, "1:45 – 1:52")
        XCTAssertEqual(p.basis, "Based on your 3 best runs of the last 8 weeks.")
        let none = #"{"prediction":{"ok":false,"race":"marathon","reason":"no_long_run","needed":"a run of at least 22 km in the last 8 weeks"}}"#
        let n = try JSONDecoder().decode(PredictionResponse.self, from: none.data(using: .utf8)!).prediction
        XCTAssertNil(n.headline)
        XCTAssertEqual(n.basis, "No estimate yet: needs a run of at least 22 km in the last 8 weeks.")
        XCTAssertEqual(RacePrediction.duration(24 * 60 + 5), "24:05")
        // Review fixes: one format across the range, slow end rounded up.
        let mixed = #"{"prediction":{"ok":true,"race":"10k","low_s":3480,"high_s":3660,"efforts":[{"date":"2026-10-04"}],"used_races":false}}"#
        XCTAssertEqual(try JSONDecoder().decode(PredictionResponse.self, from: mixed.data(using: .utf8)!).prediction.headline, "0:58 – 1:01")
        let edge = #"{"prediction":{"ok":true,"race":"half_marathon","low_s":6300,"high_s":6719,"efforts":[],"used_races":false}}"#
        XCTAssertEqual(try JSONDecoder().decode(PredictionResponse.self, from: edge.data(using: .utf8)!).prediction.headline, "1:45 – 1:52")
    }

    func testWorkoutExportCopiesThePlanStructure() throws {
        // Fixture template's threshold session: 10 + 3 x 8 (3 rest) + 10 = 50 min.
        let json = #"[{"type":"warmup","duration_min":10,"intensity":"easy"},{"type":"interval","reps":3,"work_duration_min":8,"work_intensity":"threshold","rest_duration_min":3,"rest_intensity":"easy"},{"type":"cooldown","duration_min":10,"intensity":"easy"}]"#
        let w = try WorkoutExport.customWorkout(json: json.data(using: .utf8)!, plannedType: "run", displayName: "Threshold")
        XCTAssertEqual(w.activity, .running)
        XCTAssertEqual(w.displayName, "Threshold")
        XCTAssertNotNil(w.warmup)
        XCTAssertNotNil(w.cooldown)
        XCTAssertEqual(w.blocks.map(\.iterations), [2, 1], "reps - 1 work/rest pairs, then the last rep alone")
        XCTAssertEqual(w.blocks.map { $0.steps.count }, [2, 1])
        func seconds(_ g: WorkoutGoal) -> Double {
            guard case let .time(v, unit) = g else { return 0 }
            let m: Measurement<UnitDuration> = Measurement(value: v, unit: unit)
            return m.converted(to: UnitDuration.seconds).value
        }
        var total: Double = seconds(w.warmup!.goal) + seconds(w.cooldown!.goal)
        for b in w.blocks {
            var perRound: Double = 0
            for s in b.steps { perRound += seconds(s.step.goal) }
            total += Double(b.iterations) * perRound
        }
        XCTAssertEqual(total, 50 * 60, "the Watch total equals the plan's 50 minutes")
    }

    final class FakeWatch: WatchScheduling {
        var isSupported = true
        var allow = true
        var maxScheduled = 15
        var scheduled: [(name: String, at: DateComponents)] = []
        func authorize() async -> Bool { allow }
        func scheduledCount() async -> Int { scheduled.count }
        func removeSameDay(named name: String, day: DateComponents) async {
            scheduled.removeAll { $0.name == name && $0.at.day == day.day && $0.at.month == day.month && $0.at.year == day.year }
        }
        func schedule(_ workout: CustomWorkout, at date: DateComponents) async { scheduled.append((workout.displayName ?? "", date)) }
    }

    func testWaitingPushOpensDropOldAndDuplicateReports() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        func open(_ date: String, _ sentAt: Int) -> PushOpen {
            PushOpen(userInfo: ["scora": ["kind": "daily", "date": date, "sent_at": NSNumber(value: sentAt)]])!
        }
        let fresh = open("2026-12-01", 1_800_000_000 - 3600)
        let old = open("2026-11-20", 1_800_000_000 - 8 * 86_400)
        let kept = PushOpen.pruned([old, fresh, fresh], now: now)
        XCTAssertEqual(kept, [fresh])
        let many = (0..<40).map { open("2026-12-01", 1_800_000_000 - $0) }
        XCTAssertEqual(PushOpen.pruned(many, now: now).count, 30)
        let data = try! JSONEncoder().encode([fresh])
        XCTAssertEqual(try! JSONDecoder().decode([PushOpen].self, from: data), [fresh])
    }

    @MainActor
    func testWeeklyShareCardRendersAtCardWidth() {
        let stats = [WeeklyStat(label: "LOAD", value: "412 min", trend: "+3% wk"), WeeklyStat(label: "RUNS", value: "5", trend: nil)]
        let image = WeeklyShare.render(voice: "Load came to 412 min across five runs, close to last week.", stats: stats, scale: 2)
        XCTAssertNotNil(image)
        XCTAssertEqual(image?.size.width, WeeklyShare.width)
        XCTAssertGreaterThan(image?.size.height ?? 0, 120)
        // The stat tiles are drawn: four tiles make the card taller than none.
        let four = stats + [WeeklyStat(label: "LONG RUN", value: "95 min", trend: nil), WeeklyStat(label: "HRV", value: "52ms", trend: nil)]
        let bare = WeeklyShare.render(voice: "Load came to 412 min across five runs, close to last week.", stats: [], scale: 2)
        let full = WeeklyShare.render(voice: "Load came to 412 min across five runs, close to last week.", stats: four, scale: 2)
        XCTAssertGreaterThan((full?.size.height ?? 0) - (bare?.size.height ?? 0), 100)
        XCTAssertNotNil(full?.pngData(), "exports as PNG for the share sheet")
    }

    @MainActor
    func testCDVShareCardHoldsTextAndChart() throws {
        let chart = UIGraphicsImageRenderer(size: CGSize(width: 300, height: 180)).image { ctx in
            UIColor.orange.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 300, height: 180))
        }
        let card = try XCTUnwrap(CDVShare.render(text: "HRV averaged 48ms over the month.", chart: chart, scale: 2))
        XCTAssertEqual(card.size.width, WeeklyShare.width)
        XCTAssertGreaterThan(card.size.height, 200, "text, chart and wordmark stack")
        let spec = JSONValue.object(["mark": .string("line"), "data": .object(["values": .array([])])])
        XCTAssertTrue(try XCTUnwrap(CDVChart.html(for: spec)).contains("messageHandlers.rendered"))
    }

    func testPlanHistoryKeepsEveryRowNewestFirst() throws {
        let json = """
        {"adaptations":[
          {"id":"a","adaptation_type":"downgraded","reason_text":"Thursday's tempo is now an endurance run.","triggered_at":"2026-10-20T06:00:00.000Z","dismissed":true},
          {"id":"b","adaptation_type":"skipped","reason_text":"Made room for the move.","triggered_at":"2026-10-28T06:00:00.000Z","dismissed":false},
          {"id":"c","adaptation_type":"moved","reason_text":"Tuesday's tempo moved to Wednesday.","triggered_at":"2026-10-28T05:00:00.000Z"}
        ]}
        """
        let rows = try JSONDecoder().decode(PlanAdaptationsResponse.self, from: Data(json.utf8)).adaptations
        let h = PlanChanges.history(rows)
        XCTAssertEqual(h.map(\.id), ["b", "c", "a"])
        XCTAssertEqual(h.last?.dismissed, true)
        XCTAssertNil(h[1].dismissed, "the short list endpoint has no dismissed field")
        XCTAssertEqual(PlanChanges.visible(rows).map(\.id), ["c", "a"], "the short list still hides displaced rows")
        XCTAssertEqual(h.map { PlanChanges.label($0.type) }, ["Made a rest day", "Moved", "Changed"])
        XCTAssertEqual(PlanChanges.day("2026-10-28T06:00:00.000Z", zone: TimeZone(identifier: "UTC")!), "Oct 28")
    }

    func testPushTapRoutesDailyToTodaysReadAndWeeklyToThisWeek() {
        XCTAssertEqual(PushRoute(kind: "daily"), .todaysRead)
        XCTAssertEqual(PushRoute(kind: "weekly"), .weekly)
        PushRoute.pending = .weekly
        XCTAssertEqual(PushRoute.take(), .weekly)
        XCTAssertNil(PushRoute.take(), "a route is followed once")
    }

    func testPlanSetupSendsWhatGenerationReads() throws {
        let json = #"{"goals":[{"sport":"run","goal_type":"half_marathon","label":"Half marathon","levels":[{"level":"regular","weekly_km":[30,50],"min_weeks":12},{"level":"first_timer","weekly_km":[20.5,35],"min_weeks":3}]}]}"#
        let goal = try XCTUnwrap(JSONDecoder().decode(PlanOptionsResponse.self, from: Data(json.utf8)).goals.first)
        XCTAssertEqual(goal.id, "run|half_marathon")
        XCTAssertEqual(goal.levels[0].kmRange, 30...49, "the max does not match, so 49 is the top")
        XCTAssertEqual(goal.levels[1].kmRange, 21...34)
        XCTAssertEqual(PlanSetup.clamp(10, to: goal.levels[0].kmRange), 30)
        XCTAssertEqual(PlanSetup.clamp(80, to: goal.levels[0].kmRange), 49)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let now = cal.date(from: DateComponents(year: 2026, month: 10, day: 28, hour: 21))!
        XCTAssertEqual(PlanDay.today(PlanSetup.earliestRace(from: now, minWeeks: 3, calendar: cal)), "2026-11-25", "never under four weeks")
        let earliest = PlanSetup.earliestRace(from: now, minWeeks: 12, calendar: cal)
        XCTAssertEqual(PlanDay.today(earliest), "2027-01-20", "the shortest plan for the level")
        let body = PlanSetup.body(athleteId: "a1", goal: goal, raceDate: earliest, weeklyKm: 35, level: "regular", now: now)
        XCTAssertEqual(body["sport"] as? String, "run")
        XCTAssertEqual(body["goal_type"] as? String, "half_marathon")
        XCTAssertEqual(body["experience_level"] as? String, "regular")
        XCTAssertEqual(body["current_weekly_km"] as? Int, 35)
        XCTAssertEqual(body["goal_race_date"] as? String, "2027-01-20")
        XCTAssertEqual(body["today"] as? String, "2026-10-28")
        XCTAssertEqual(PlanSetup.levelText("first_timer"), "First timer or first serious block")
    }

    func testPlanBlockReadsWeekPhaseAndRace() throws {
        let json = #"{"block":{"goal":"Half marathon","week":4,"weeks":12,"race_date":"2026-12-27","phases":[{"name":"Base","first_week":1,"last_week":4,"focus":"aerobic development","current":true},{"name":"Build","first_week":5,"last_week":9,"focus":"threshold work","current":false}]}}"#
        let block = try XCTUnwrap(JSONDecoder().decode(PlanBlockResponse.self, from: Data(json.utf8)).block)
        XCTAssertEqual(block.headline, "Week 4 of 12 · Base")
        XCTAssertEqual(block.raceLine, "Half marathon, Dec 27")
        XCTAssertNil(try JSONDecoder().decode(PlanBlockResponse.self, from: Data(#"{"block":null}"#.utf8)).block)
        let later = #"{"goal":"Marathon","week":1,"weeks":16,"race_date":"2027-03-14","starts_on":"2026-11-23","phases":[]}"#
        XCTAssertEqual(try JSONDecoder().decode(PlanBlock.self, from: Data(later.utf8)).headline, "Starts Nov 23 · 16 weeks")
    }

    func testReadDecodesTheTodayLineWhenPresent() throws {
        let with = #"{"voice":"Body is settled.","numbers":"Sleep 7:12","today":"Today: 40-minute easy run."}"#
        XCTAssertEqual(try JSONDecoder().decode(DailyRead.self, from: Data(with.utf8)).today, "Today: 40-minute easy run.")
        let without = #"{"voice":"Body is settled."}"#
        XCTAssertNil(try JSONDecoder().decode(DailyRead.self, from: Data(without.utf8)).today)
    }

    func testPushOpenReadsTheScoraPayloadOnly() {
        let ok = PushOpen(userInfo: ["aps": ["alert": "x"], "scora": ["kind": "daily", "date": "2026-10-28", "sent_at": NSNumber(value: 1_793_181_600)]])
        XCTAssertEqual(ok?.kind, "daily")
        XCTAssertEqual(ok?.date, "2026-10-28")
        XCTAssertEqual(ok?.sentAt, 1_793_181_600)
        XCTAssertNil(PushOpen(userInfo: ["aps": ["alert": "x"]]), "a push without the payload is not a scheduled read")
        XCTAssertNil(PushOpen(userInfo: ["scora": ["kind": "hourly", "date": "2026-10-28", "sent_at": 1]]))
        XCTAssertNil(PushOpen(userInfo: ["scora": ["kind": "weekly", "date": "today", "sent_at": 1]]))
    }

    func testSendToWatchSchedulesAt6OnThePlanDay() async {
        let steps = [PlanStep(type: "warmup", durationMin: 10, intensity: "easy", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil),
                     PlanStep(type: "steady", durationMin: 30, intensity: "tempo", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        let watch = FakeWatch()
        let early = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 20))!
        let o = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "tempo · 40 min", dayLabel: "Fri Oct 23", scheduler: watch, now: early)
        XCTAssertEqual(o, .sent("Fri Oct 23"))
        XCTAssertEqual(watch.scheduled.map(\.at), [DateComponents(year: 2026, month: 10, day: 23, hour: 6, minute: 0)])
        // Sending again replaces the first send.
        _ = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "tempo · 40 min", dayLabel: "Fri Oct 23", scheduler: watch, now: early)
        XCTAssertEqual(watch.scheduled.count, 1)
        XCTAssertEqual(WatchSend.message(o), "Sent to your Watch for Fri Oct 23.")

        watch.allow = false
        let denied = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "x", dayLabel: "x", scheduler: watch, now: early)
        XCTAssertEqual(denied, .notAuthorized)
        watch.isSupported = false
        let unsupported = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "x", dayLabel: "x", scheduler: watch, now: early)
        XCTAssertEqual(unsupported, .unsupported)
        XCTAssertEqual(watch.scheduled.count, 1, "nothing scheduled without permission or support")
        let full = FakeWatch(); full.maxScheduled = 0
        let fullOutcome = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "x", dayLabel: "x", scheduler: full, now: early)
        XCTAssertEqual(fullOutcome, .full)
        let swim = await WatchSend.send(steps: steps, type: "swim", date: "2026-10-23", displayName: "x", dayLabel: "x", scheduler: FakeWatch(), now: early)
        XCTAssertEqual(swim, .cannotCopy)
    }

    func testTodaysSessionIsNeverScheduledInThePast() {
        let cal = Calendar.current
        let nine = cal.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 9, minute: 30))!
        let c = WatchSend.scheduleTime(for: "2026-10-22", now: nine)!
        XCTAssertEqual([c.year, c.month, c.day, c.hour, c.minute], [2026, 10, 22, 9, 31])
        let five = cal.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 5))!
        XCTAssertEqual(WatchSend.scheduleTime(for: "2026-10-22", now: five), DateComponents(year: 2026, month: 10, day: 22, hour: 6, minute: 0))
        let lateNight = cal.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 23, minute: 59, second: 30))!
        XCTAssertNil(WatchSend.scheduleTime(for: "2026-10-22", now: lateNight), "the day is over")
    }

    func testSendToWatchOnlyOffersSessionsItCanCopyThisWeek() {
        let steps = [PlanStep(type: "steady", durationMin: 30, intensity: "easy", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        XCTAssertTrue(WatchSend.canSend(type: "run", steps: steps, date: "2026-10-22", today: "2026-10-22"))
        XCTAssertTrue(WatchSend.canSend(type: "ride", steps: steps, date: "2026-10-29", today: "2026-10-22"))
        XCTAssertFalse(WatchSend.canSend(type: "run", steps: steps, date: "2026-10-30", today: "2026-10-22"), "more than a week out")
        XCTAssertFalse(WatchSend.canSend(type: "run", steps: steps, date: "2026-10-21", today: "2026-10-22"), "in the past")
        XCTAssertFalse(WatchSend.canSend(type: "run", steps: nil, date: "2026-10-23", today: "2026-10-22"), "a pasted plan has no steps")
        XCTAssertFalse(WatchSend.canSend(type: "swim", steps: steps, date: "2026-10-23", today: "2026-10-22"))
    }

    func testPlanWorkoutReadsItsStructure() throws {
        let json = #"{"scheduled_date":"2026-10-23","planned_type":"run","planned_intensity":"tempo","planned_duration_min":40,"planned_distance_km":null,"planned_description":null,"workout_structure_json":[{"type":"steady","duration_min":40,"intensity":"tempo"}]}"#
        let w = try JSONDecoder().decode(PlanWorkout.self, from: Data(json.utf8))
        XCTAssertEqual(w.steps?.count, 1)
        let pasted = try JSONDecoder().decode(PlanWorkout.self, from: Data(#"{"scheduled_date":"2026-10-23","planned_type":"run"}"#.utf8))
        XCTAssertNil(pasted.steps)
    }

    func testWorkoutExportRefusesWhatItCannotCopy() {
        XCTAssertThrowsError(try WorkoutExport.customWorkout(steps: [], plannedType: "run", displayName: "x")) {
            XCTAssertEqual($0 as? WorkoutExportError, .empty)
        }
        let bad = [PlanStep(type: "interval", durationMin: nil, intensity: nil, reps: 0, workDurationMin: 2, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        XCTAssertThrowsError(try WorkoutExport.customWorkout(steps: bad, plannedType: "run", displayName: "x")) {
            XCTAssertEqual($0 as? WorkoutExportError, .badStep(0))
        }
        let steady = [PlanStep(type: "steady", durationMin: 40, intensity: "easy", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        XCTAssertThrowsError(try WorkoutExport.customWorkout(steps: steady, plannedType: "other", displayName: "x")) {
            XCTAssertEqual($0 as? WorkoutExportError, .unsupportedActivity("other"))
        }
        XCTAssertNoThrow(try WorkoutExport.customWorkout(steps: steady, plannedType: "run", displayName: "Easy"))
        // Review fixes: a warmup-only session keeps its step as a block; swims are refused.
        let warm = [PlanStep(type: "warmup", durationMin: 20, intensity: "easy", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        let w = try? WorkoutExport.customWorkout(steps: warm, plannedType: "run", displayName: "Shakeout")
        XCTAssertEqual(w?.blocks.count, 1)
        XCTAssertNil(w?.warmup)
        XCTAssertThrowsError(try WorkoutExport.customWorkout(steps: steady, plannedType: "swim", displayName: "x"))
    }

    func testSkippedNote() {
        XCTAssertNil(PlanDay.skippedNote(0))
        XCTAssertEqual(PlanDay.skippedNote(1), "1 line could not be read and was left out.")
        XCTAssertEqual(PlanDay.skippedNote(3), "3 lines could not be read and were left out.")
        XCTAssertEqual(PlanDay.skippedNote(2, unit: "event"), "2 events could not be read and were left out.")
    }

    func testCalendarFeedLinks() {
        XCTAssertEqual(CalendarFeed.normalizedURL(" webcal://plans.example.com/feed/abc.ics ")?.absoluteString, "https://plans.example.com/feed/abc.ics")
        XCTAssertEqual(CalendarFeed.normalizedURL("WEBCAL://plans.example.com/a.ics")?.absoluteString, "https://plans.example.com/a.ics")
        XCTAssertEqual(CalendarFeed.normalizedURL("https://plans.example.com/a.ics")?.host, "plans.example.com")
        XCTAssertNil(CalendarFeed.normalizedURL("http://plans.example.com/a.ics"))
        XCTAssertNil(CalendarFeed.normalizedURL("file:///etc/hosts"))
        XCTAssertNil(CalendarFeed.normalizedURL("not a link"))
        XCTAssertNil(CalendarFeed.normalizedURL(""))
    }

    func testCalendarFeedRefreshTiming() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let link = "webcal://plans.example.com/a.ics"
        XCTAssertFalse(CalendarFeed.needsRefresh(link: nil, lastRefresh: nil, now: now))
        XCTAssertFalse(CalendarFeed.needsRefresh(link: "not a link", lastRefresh: nil, now: now))
        XCTAssertTrue(CalendarFeed.needsRefresh(link: link, lastRefresh: nil, now: now))
        XCTAssertFalse(CalendarFeed.needsRefresh(link: link, lastRefresh: now.addingTimeInterval(-3600), now: now))
        XCTAssertTrue(CalendarFeed.needsRefresh(link: link, lastRefresh: now.addingTimeInterval(-13 * 3600), now: now))
    }

    func testCalendarFeedLinkIsPerAthlete() {
        CalendarFeed.save("webcal://plans.example.com/a.ics", for: "test-a")
        defer { CalendarFeed.save(nil, for: "test-a") }
        XCTAssertEqual(CalendarFeed.savedLink(for: "test-a"), "webcal://plans.example.com/a.ics")
        XCTAssertNil(CalendarFeed.savedLink(for: "test-b"), "another athlete on this phone never sees it")
        XCTAssertNotNil(CalendarFeed.lastRefresh(for: "test-a"))
        CalendarFeed.save(nil, for: "test-a")
        XCTAssertNil(CalendarFeed.savedLink(for: "test-a"))
        XCTAssertNil(CalendarFeed.lastRefresh(for: "test-a"))
    }

    func testDismissingAPlanChangeRemovesOnlyThatOne() throws {
        let json = #"{"adaptations":[{"id":"a","adaptation_type":"moved","reason_text":"One.","triggered_at":"2026-10-21T06:00:00.000Z"},{"id":"b","adaptation_type":"downgraded","reason_text":"Two.","triggered_at":"2026-10-22T06:00:00.000Z"}]}"#
        let rows = try JSONDecoder().decode(PlanAdaptationsResponse.self, from: Data(json.utf8)).adaptations
        XCTAssertEqual(PlanChanges.dismissing("a", from: rows).map(\.id), ["b"])
        XCTAssertEqual(PlanChanges.dismissing("zzz", from: rows).count, 2)
    }

    func testPlanListCarriesUnmarkedPastSessions() throws {
        let json = #"{"workouts":[],"recent":[{"id":"3f1c2a4e-0000-4000-8000-000000000001","scheduled_date":"2026-10-20","planned_type":"run","planned_intensity":"tempo","planned_duration_min":40}]}"#
        let r = try JSONDecoder().decode(PlanListResponse.self, from: Data(json.utf8))
        XCTAssertEqual(r.recent?.first?.rowId, "3f1c2a4e-0000-4000-8000-000000000001")
        XCTAssertNil(try JSONDecoder().decode(PlanListResponse.self, from: Data(#"{"workouts":[]}"#.utf8)).recent)
    }

    func testCalendarFeedText() {
        XCTAssertNotNil(CalendarFeed.calendarText(Data("BEGIN:VCALENDAR\r\nEND:VCALENDAR".utf8)))
        XCTAssertNil(CalendarFeed.calendarText(Data("<html>sign in</html>".utf8)))
        XCTAssertNil(CalendarFeed.calendarText(Data(repeating: 65, count: CalendarFeed.maxBytes + 1)))
    }

    // MARK: - Onboarding

    func testOnboardingStepsRunInSpecOrder() {
        XCTAssertEqual(OnboardingStep.allCases, [.oura, .health, .plan, .delivery, .done])
        XCTAssertEqual(OnboardingStep.oura.next, .health)
        XCTAssertNil(OnboardingStep.done.next)
    }

    func testDeliveryMinuteAndZoneLabel() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let t = cal.date(from: DateComponents(year: 2026, month: 10, day: 17, hour: 6, minute: 30))!
        XCTAssertEqual(OnboardingState.deliveryMinute(from: t, calendar: cal), 390)
        XCTAssertEqual(OnboardingState.zoneLabel(TimeZone(identifier: "America/Los_Angeles")!), "Los Angeles")
    }

    // Flag logic only: saveToken is not called here because it can register
    // a device with the production API.
    func testOnboardingFlagIsReadAtLaunchAndClearedOnFinish() {
        OnboardingState.needsOnboarding = true
        let tm = TokenManager()
        XCTAssertTrue(tm.needsOnboarding)
        tm.finishOnboarding()
        XCTAssertFalse(OnboardingState.needsOnboarding)
        XCTAssertFalse(TokenManager().needsOnboarding)
    }

    // MARK: - CDV chart

    private func decode(_ json: String) throws -> CDVResponse {
        try JSONDecoder().decode(CDVResponse.self, from: Data(json.utf8))
    }

    func testCDVResponseWithoutChartDecodes() throws {
        let r = try decode(#"{"voice":"Load is steady.","drivers":[],"remaining":2,"limit":3}"#)
        XCTAssertNil(r.chart)
    }

    func testCDVResponseWithInlineChartBuildsHTML() throws {
        let r = try decode(#"""
        {"voice":"Load is steady.","drivers":[],"chart":{"mark":"line",
         "data":{"values":[{"d":"2026-10-01","km":8},{"d":"2026-10-02","km":12.5}]},
         "encoding":{"x":{"field":"d","type":"temporal"},"y":{"field":"km","type":"quantitative"}}}}
        """#)
        let spec = try XCTUnwrap(r.chart)
        let html = try XCTUnwrap(CDVChart.html(for: spec))
        XCTAssertTrue(html.contains("vegaEmbed"))
        XCTAssertTrue(html.contains("12.5"))
    }

    func testChartWithExternalDataURLIsRejected() throws {
        let r = try decode(#"{"voice":"x","drivers":[],"chart":{"mark":"bar","data":{"url":"https://example.com/d.json"}}}"#)
        XCTAssertNil(CDVChart.html(for: try XCTUnwrap(r.chart)))
    }

    func testChartWithNestedHrefIsRejected() throws {
        let r = try decode(#"{"voice":"x","drivers":[],"chart":{"layer":[{"mark":"point","encoding":{"HREF":{"field":"a"}}}]}}"#)
        XCTAssertNil(CDVChart.html(for: try XCTUnwrap(r.chart)))
    }

    func testNonObjectChartIsRejected() throws {
        XCTAssertNil(CDVChart.html(for: .array([.number(1)])))
    }

    func testChartStringsCannotCloseScriptTag() throws {
        let spec = JSONValue.object(["title": .string("</script><script>alert(1)</script>"), "mark": .string("bar")])
        let html = try XCTUnwrap(CDVChart.html(for: spec))
        XCTAssertFalse(html.contains("</script><script>alert"))
        XCTAssertTrue(html.contains("\\u003c"))
    }

}
