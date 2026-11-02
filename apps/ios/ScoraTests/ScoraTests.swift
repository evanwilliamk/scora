//
//  ScoraTests.swift
//  ScoraTests
//
//  Created by everett kosowski on 7/2/26.
//

import XCTest
import WorkoutKit
import UserNotifications
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
        XCTAssertEqual(w.detail, "tempo · 45 min · 5 mi")
        let ride = PlanWorkout(date: "2026-10-24", type: "ride", intensity: nil, durationMin: nil, distanceKm: 25.75, description: nil)
        XCTAssertEqual(ride.detail, "ride · 16 mi")
    }

    func testPlanDistanceReadsMilesAsWritten() {
        // "Sat: 13.1 mi long" is stored as 21.08 km (numeric(6, 2)) and reads back as written.
        for mi in [3.1, 5, 6.2, 10, 13.1, 16, 26.2, 50] {
            let stored = (mi * PlanDistance.kmPerMile * 100).rounded() / 100
            XCTAssertEqual(PlanDistance.format(km: stored), mi.rounded() == mi ? "\(Int(mi)) mi" : "\(mi) mi")
        }
        XCTAssertEqual(PlanDistance.format(km: 25.75, unit: .km), "25.8 km")
        XCTAssertEqual(PlanDistance.format(km: 8, unit: .km), "8 km")
    }

    func testPlanDistancePositiveNeverReadsZero() {
        XCTAssertEqual(PlanDistance.format(km: 0.05), "0.03 mi")
        XCTAssertEqual(PlanDistance.format(km: 0.01), "0.01 mi")
        XCTAssertEqual(PlanDistance.format(km: 0.0001), "0.01 mi")
        XCTAssertEqual(PlanDistance.format(km: 0.15), "0.09 mi")
        XCTAssertEqual(PlanDistance.format(km: 0.161), "0.1 mi")
        XCTAssertEqual(PlanDistance.format(km: 0.1608), "0.1 mi")
        XCTAssertEqual(PlanDistance.format(km: 0.004, unit: .km), "0.01 km")
        XCTAssertEqual(PlanDistance.format(km: 0.05, unit: .km), "0.05 km")
        XCTAssertEqual(PlanDistance.format(km: 0), "0 mi")
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

    func testRatioAndDayCountFormatsAndBars() {
        XCTAssertEqual(DriverSeries.format(1.32, unit: "ratio"), "1.32")
        XCTAssertEqual(DriverSeries.format(1.3, unit: "ratio"), "1.30")
        XCTAssertEqual(DriverSeries.format(3, unit: "days"), "3 days")
        XCTAssertEqual(DriverSeries.format(1, unit: "days"), "1 day")
        let hard = DriverSeries(key: "hard_days", label: "Hard days in a row", unit: "days", points: [], baseline: nil)
        let acwr = DriverSeries(key: "acwr", label: "Acute:chronic load", unit: "ratio", points: [], baseline: nil)
        XCTAssertTrue(hard.isDailyTotal, "counts draw as bars")
        XCTAssertFalse(acwr.isDailyTotal, "a ratio draws as a line")
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

    func testAPIErrorTextKeepsDeveloperLabelsOffScreen() {
        // What the API sends today: labels for developers fall back, sentences for the athlete show.
        for raw in ["LLM failed", "CDV failed", "Strava token invalid or expired", "Missing: athleteId",
                    "Missing: message, athleteId", "Not found", "Unknown card: sleep", "Bad Request",
                    "Oura not configured (OURA_CLIENT_ID missing).", "   "] {
            let body = try! JSONSerialization.data(withJSONObject: ["error": raw])
            XCTAssertEqual(APIErrorText.message(from: body, fallback: "fallback"), "fallback", raw)
        }
        for raw in ["You've used your 3 chats for today. Resets tomorrow.",
                    "Message is too long (1000 characters at most).",
                    "Strava not connected or refresh failed. Please reconnect Strava.",
                    "No recent read. Refresh the dashboard first."] {
            let body = try! JSONSerialization.data(withJSONObject: ["error": raw])
            XCTAssertEqual(APIErrorText.message(from: body, fallback: "fallback"), raw)
        }
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
            hrv: [HRVSample(date: at("2026-10-18T10:00:00Z"), value: 50), HRVSample(date: at("2026-10-18T11:00:00Z"), value: 54),
                  HRVSample(date: at("2026-10-17T11:00:00Z"), value: 44)],
            restingHr: [(date: at("2026-10-18T12:00:00Z"), value: 48.4)],
            calendar: cal)
        XCTAssertEqual(nights, [
            HealthNight(day: "2026-10-17", sleepSeconds: nil, hrvMs: 44, restingHr: nil),
            HealthNight(day: "2026-10-18", sleepSeconds: 7 * 3600, hrvMs: 54, restingHr: 48),
        ])
    }

    func testLastNightRestingHRIsTheNewestWithin36Hours() {
        let f = ISO8601DateFormatter()
        let at = { (s: String) in f.date(from: s)! }
        let now = at("2026-10-19T10:00:00Z")
        let rhr: [(date: Date, value: Double)] = [(date: at("2026-10-18T20:00:00Z"), value: 48.4)]
        XCTAssertEqual(HealthNights.lastNightRestingHR(rhr, now: now), 48)
        XCTAssertNil(HealthNights.lastNightRestingHR(rhr, now: at("2026-10-21T10:00:00Z")), "stale values are not last night's")
    }

    // A fake HealthKit night in New York: asleep 23:00 to 06:30 local.
    private var newYork: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York")!
        return cal
    }
    private func at(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }
    private var lastNightSleep: [(start: Date, end: Date)] {
        [(start: at("2026-10-19T03:00:00Z"), end: at("2026-10-19T10:30:00Z"))]
    }

    func testLastNightHRVIgnoresDaytimeReadings() {
        let hrv = [
            HRVSample(date: at("2026-10-19T07:00:00Z"), value: 52.04, source: "com.apple.health"), // 03:00, asleep
            HRVSample(date: at("2026-10-19T16:00:00Z"), value: 31, source: "com.apple.health"), // 12:00, after a run
        ]
        // A 2 PM refresh still cites the overnight reading, not the newest one.
        let afternoon = at("2026-10-19T18:00:00Z")
        XCTAssertEqual(HealthNights.lastNightHRV(hrv, sleep: lastNightSleep, now: afternoon, calendar: newYork), 52)
        // A reading just after waking (within 30 minutes) still counts; an hour later does not.
        let justAfter = [HRVSample(date: at("2026-10-19T10:50:00Z"), value: 60)]
        XCTAssertEqual(HealthNights.lastNightHRV(justAfter, sleep: lastNightSleep, now: afternoon, calendar: newYork), 60)
        let later = [HRVSample(date: at("2026-10-19T11:30:00Z"), value: 60)]
        XCTAssertNil(HealthNights.lastNightHRV(later, sleep: lastNightSleep, now: afternoon, calendar: newYork))
        // Only daytime readings: no HRV last night, so nil, never a stand-in.
        XCTAssertNil(HealthNights.lastNightHRV([hrv[1]], sleep: lastNightSleep, now: afternoon, calendar: newYork))
        // The night before's reading is not last night's.
        let nightBefore = [HRVSample(date: at("2026-10-18T07:00:00Z"), value: 70)]
        XCTAssertNil(HealthNights.lastNightHRV(nightBefore, sleep: lastNightSleep, now: afternoon, calendar: newYork))
        XCTAssertNil(HealthNights.lastNightHRV([], sleep: lastNightSleep, now: afternoon, calendar: newYork))
    }

    func testLastNightHRVWithoutSleepUsesTheOvernightHours() {
        // No sleep recorded: 20:00 to 10:00 New York time.
        let hrv = [
            HRVSample(date: at("2026-10-18T23:30:00Z"), value: 40), // 19:30 the evening before: out
            HRVSample(date: at("2026-10-19T05:00:00Z"), value: 48), // 01:00: in
            HRVSample(date: at("2026-10-19T15:00:00Z"), value: 30), // 11:00: out
        ]
        let noon = at("2026-10-19T16:00:00Z")
        XCTAssertEqual(HealthNights.lastNightHRV(hrv, sleep: [], now: noon, calendar: newYork), 48)
        // The window is in the athlete's zone: in Los Angeles 01:00 New York is 22:00, still in;
        // 11:00 New York is 08:00 Los Angeles, also in, and it is the latest.
        var la = Calendar(identifier: .gregorian)
        la.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        XCTAssertEqual(HealthNights.lastNightHRV(hrv, sleep: [], now: noon, calendar: la), 30)
    }

    func testLastNightHRVReadsOneSourceNotAMix() {
        // The Watch writes several readings overnight; Oura writes one into Health.
        let watch = "com.apple.health.watch", oura = "com.ouraring.oura"
        let hrv = [
            HRVSample(date: at("2026-10-19T05:00:00Z"), value: 44, source: watch),
            HRVSample(date: at("2026-10-19T07:00:00Z"), value: 46, source: watch),
            HRVSample(date: at("2026-10-19T10:15:00Z"), value: 70, source: oura), // newest overall
        ]
        let noon = at("2026-10-19T16:00:00Z")
        XCTAssertEqual(HealthNights.lastNightHRV(hrv, sleep: lastNightSleep, now: noon, calendar: newYork), 46,
                       "the source with the most readings that night, its latest reading")
        // A tie goes to the source with the latest reading.
        let tie = [hrv[1], hrv[2]]
        XCTAssertEqual(HealthNights.lastNightHRV(tie, sleep: lastNightSleep, now: noon, calendar: newYork), 70)
        // The dated nights for the charts and the week baseline follow the same rule.
        let nights = HealthNights.group(sleep: lastNightSleep, hrv: hrv + [HRVSample(date: at("2026-10-19T16:00:00Z"), value: 20, source: watch)],
                                        restingHr: [], calendar: newYork)
        XCTAssertEqual(nights.first { $0.day == "2026-10-19" }?.hrvMs, 46)
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
        var scheduled: [WatchCopy] = []
        func authorize() async -> Bool { allow }
        func isAuthorized() async -> Bool { allow }
        func scheduledCount() async -> Int { scheduled.count }
        func scheduledWorkouts() async -> [WatchCopy] { scheduled }
        func removeScheduled(where match: (WatchCopy) -> Bool) async { scheduled.removeAll(where: match) }
        func schedule(_ workout: CustomWorkout, id: UUID?, at date: DateComponents) async {
            scheduled.append(WatchCopy(name: workout.displayName ?? "", at: date, id: id ?? UUID(), workout: workout))
        }
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
        XCTAssertEqual(body["current_weekly_km"] as? Double, 35)
        XCTAssertEqual(body["goal_race_date"] as? String, "2027-01-20")
        XCTAssertEqual(body["today"] as? String, "2026-10-28")
        XCTAssertEqual(PlanSetup.levelText("first_timer"), "First timer or first serious block")
    }

    // Q32 B: the form asks in the athlete's unit (miles today) and posts km.
    func testPlanSetupAsksInMilesAndPostsKm() throws {
        XCTAssertEqual(PlanDistance.unit, .mi)
        let json = #"{"goals":[{"sport":"run","goal_type":"half_marathon","label":"Half marathon","levels":[{"level":"regular","weekly_km":[30,50],"min_weeks":12},{"level":"first_timer","weekly_km":[20.5,35],"min_weeks":3},{"level":"competitive","weekly_km":[0,900],"min_weeks":3}]}]}"#
        let goal = try XCTUnwrap(JSONDecoder().decode(PlanOptionsResponse.self, from: Data(json.utf8)).goals.first)
        // Every whole mile offered posts km inside the level's [min, max).
        XCTAssertEqual(goal.levels[0].range(), 19...31)
        XCTAssertEqual(goal.levels[1].range(), 13...21)
        for level in goal.levels.prefix(2) {
            let r = level.range()
            XCTAssertGreaterThanOrEqual(PlanSetup.km(r.lowerBound), level.weeklyKm[0])
            XCTAssertLessThan(PlanSetup.km(r.upperBound), level.weeklyKm[1])
            XCTAssertLessThan(PlanSetup.km(r.lowerBound - 1), level.weeklyKm[0])
            XCTAssertGreaterThanOrEqual(PlanSetup.km(r.upperBound + 1), level.weeklyKm[1])
        }
        // The API's 0 to 500 km, in miles.
        XCTAssertEqual(goal.levels[2].range(), 0...310)
        XCTAssertLessThanOrEqual(PlanSetup.km(310), 500)
        XCTAssertEqual(goal.levels[2].range(in: .km), 0...500)

        XCTAssertEqual(PlanSetup.km(25), 40.23, "25 mi, at the API's two decimals")
        XCTAssertEqual(PlanSetup.km(25, unit: .km), 25)
        XCTAssertEqual(PlanSetup.startingVolume(), 19)
        XCTAssertEqual(PlanSetup.startingVolume(unit: .km), 30)
        XCTAssertEqual(PlanSetup.volumeLabel(25), "25 mi a week")
        XCTAssertEqual(PlanSetup.volumeLabel(40, unit: .km), "40 km a week")

        let body = PlanSetup.body(athleteId: "a1", goal: goal, raceDate: Date(), weeklyKm: PlanSetup.km(25), level: "regular")
        XCTAssertEqual(body["current_weekly_km"] as? Double, 40.23, "what is posted is km")
        let wire = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: body)) as? [String: Any])
        XCTAssertEqual((wire["current_weekly_km"] as? NSNumber)?.doubleValue, 40.23)
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

    func testSendToWatchIsNeverOfferedOnARestDay() {
        let steps = [PlanStep(type: "steady", durationMin: 30, intensity: "easy", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        XCTAssertFalse(WatchSend.canSend(type: "run", intensity: "rest", steps: steps, date: "2026-10-23", today: "2026-10-22"))
        XCTAssertTrue(WatchSend.canSend(type: "run", intensity: "easy", steps: steps, date: "2026-10-23", today: "2026-10-22"))
    }

    func testPlanChangesThatFailToLoadAreNotSilent() {
        XCTAssertEqual(PlanChanges.loadOutcome(status: 200), .loaded)
        XCTAssertEqual(PlanChanges.loadOutcome(status: 404), .off, "adaptations switched off: nothing to say")
        XCTAssertEqual(PlanChanges.loadOutcome(status: 500), .failed)
        XCTAssertEqual(PlanChanges.loadOutcome(status: 0), .failed, "offline")
        XCTAssertFalse(PlanSheet.changesFailed.contains("\u{2014}"))
    }

    func testPastSessionMarkButtonsNameTheirSession() {
        let w = PlanWorkout(date: "2026-10-20", type: "run", intensity: "tempo", durationMin: 45, distanceKm: nil, description: nil)
        XCTAssertEqual(PlanSheet.markLabel(w, done: true), "Mark Tue Oct 20, tempo, 45 min, as completed")
        XCTAssertEqual(PlanSheet.markLabel(w, done: false), "Mark Tue Oct 20, tempo, 45 min, as missed")
        XCTAssertEqual(PlanSheet.watchLabel(w), "Send Tue Oct 20, tempo, 45 min, to Watch")
    }

    func testSendingAnAdaptedSessionReplacesTheEarlierSendThatDay() async {
        // The plan engine downgraded Friday's tempo after it was sent: its
        // name changed, but the Watch must still hold one session for Friday.
        let steps = [PlanStep(type: "steady", durationMin: 40, intensity: "easy", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        let watch = FakeWatch()
        let early = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 20))!
        _ = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "tempo · 40 min", dayLabel: "Fri Oct 23", scheduler: watch, now: early)
        _ = await WatchSend.send(steps: steps, type: "run", date: "2026-10-24", displayName: "long · 90 min", dayLabel: "Sat Oct 24", scheduler: watch, now: early)
        _ = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "endurance · 40 min", dayLabel: "Fri Oct 23",
                                 replacing: "tempo · 40 min", scheduler: watch, now: early)
        XCTAssertEqual(watch.scheduled.map(\.name).sorted(), ["endurance · 40 min", "long · 90 min"], "Friday's stale tempo is gone, Saturday stays")
    }

    func testResendingOneSessionKeepsTheDaysOtherSession() async {
        // A coach plan can hold two sessions in a day; sending one again must
        // replace only its own earlier copy.
        let steps = [PlanStep(type: "steady", durationMin: 40, intensity: "easy", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        let watch = FakeWatch()
        let early = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 20))!
        _ = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "easy · 40 min", dayLabel: "Fri Oct 23", scheduler: watch, now: early)
        _ = await WatchSend.send(steps: steps, type: "ride", date: "2026-10-23", displayName: "recovery · 40 min", dayLabel: "Fri Oct 23", scheduler: watch, now: early)
        _ = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "easy · 40 min", dayLabel: "Fri Oct 23", scheduler: watch, now: early)
        XCTAssertEqual(watch.scheduled.map(\.name).sorted(), ["easy · 40 min", "recovery · 40 min"])
    }

    func testASendJustBeforeMidnightStaysOnItsDay() {
        let cal = Calendar.current
        let lateNight = cal.date(from: DateComponents(year: 2026, month: 10, day: 22, hour: 23, minute: 59, second: 30))!
        let c = WatchSend.scheduleTime(for: "2026-10-22", now: lateNight)
        XCTAssertEqual(c.map { [$0.year, $0.month, $0.day] }, [2026, 10, 22], "the day is still running")
        let nextDay = cal.date(from: DateComponents(year: 2026, month: 10, day: 23, hour: 0, minute: 0, second: 30))!
        XCTAssertNil(WatchSend.scheduleTime(for: "2026-10-22", now: nextDay), "the day is over")
    }

    // MARK: Watch reconcile

    private func session(_ date: String, _ intensity: String, _ min: Int, row: String?, steps: [PlanStep]? = nil, type: String = "run") -> PlanWorkout {
        var w = PlanWorkout(date: date, type: type, intensity: intensity, durationMin: min, distanceKm: nil, description: nil)
        w.rowId = row
        w.steps = steps ?? [PlanStep(type: "steady", durationMin: Double(min), intensity: intensity, reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        return w
    }
    private func at6(_ day: Int) -> DateComponents { DateComponents(year: 2026, month: 11, day: day, hour: 6, minute: 0) }
    private var reconcileNow: Date { Calendar.current.date(from: DateComponents(year: 2026, month: 11, day: 3, hour: 5))! }

    // Sends `w` with the fake Watch and records it, as Your Plan does.
    // `olderBuild`: as a build before plan ids sent it (a random id).
    private func sent(_ ws: [PlanWorkout], to watch: FakeWatch, olderBuild: Bool = false) -> WatchLedger {
        var ledger = WatchLedger()
        for w in ws {
            let workout = try! WorkoutExport.customWorkout(steps: w.steps!, plannedType: w.type, displayName: w.detail)
            let id = olderBuild ? UUID() : WatchPlanId.forSession(rowId: w.rowId!)
            watch.scheduled.append(WatchCopy(name: w.detail, at: at6(Int(w.date.suffix(2))!), id: id, workout: workout))
            ledger.recordSend(w)
        }
        return ledger
    }

    @MainActor
    func testAMovedSessionMovesOnTheWatchWhenTheAthleteSentIt() async {
        let watch = FakeWatch()
        let tue = session("2026-11-03", "tempo", 45, row: "r1")
        let ledger = sent([tue], to: watch)
        // The plan engine moved it to Wednesday, unchanged otherwise.
        let wed = session("2026-11-04", "tempo", 45, row: "r1")
        let out = await WatchReconcile.run(workouts: [wed], coveredThrough: nil, ledger: ledger, scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertEqual(watch.scheduled.map(\.at), [at6(4)], "Tuesday's copy is gone, Wednesday's is on the Watch")
        XCTAssertEqual(out.note(for: wed), "Moved from Tue Nov 3. Its Watch copy moved with it.")
        XCTAssertEqual(out.sends.map(\.date), ["2026-11-04"])
        // Running again changes nothing.
        let again = await WatchReconcile.run(workouts: [wed], coveredThrough: nil, ledger: out, scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertEqual(watch.scheduled.map(\.at), [at6(4)])
        XCTAssertEqual(again, out)
    }

    @MainActor
    func testAMovedAndChangedSessionIsRemovedAndNotSentAgain() async {
        let watch = FakeWatch()
        let ledger = sent([session("2026-11-03", "tempo", 45, row: "r1")], to: watch)
        let wed = session("2026-11-04", "endurance", 45, row: "r1") // moved and downgraded
        let out = await WatchReconcile.run(workouts: [wed], coveredThrough: nil, ledger: ledger, scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertTrue(watch.scheduled.isEmpty, "unsure it is the same session: removed, not resent")
        XCTAssertEqual(out.note(for: wed), "Moved from Tue Nov 3. Its Watch copy for Tue Nov 3 was removed and has not been sent for this day.")
    }

    @MainActor
    func testADowngradedOrRemovedSessionLeavesTheWatchWithANote() async {
        let watch = FakeWatch()
        let ledger = sent([session("2026-11-03", "tempo", 45, row: "r1"), session("2026-11-05", "long", 90, row: "r2")], to: watch)
        let tueEasy = session("2026-11-03", "endurance", 45, row: "r1") // downgraded in place
        let thuRest = session("2026-11-05", "rest", 0, row: "r3") // Thursday's run is gone
        let plan = [tueEasy, thuRest]
        let out = await WatchReconcile.run(workouts: plan, coveredThrough: nil, ledger: ledger, scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertTrue(watch.scheduled.isEmpty)
        XCTAssertEqual(out.note(for: tueEasy), WatchReconcile.changed)
        XCTAssertEqual(out.note(for: thuRest), "Thu Nov 5's session is no longer on your plan, so its Watch copy was removed.")
        XCTAssertEqual(out.unattachedNotes([tueEasy]), ["Thu Nov 5's session is no longer on your plan, so its Watch copy was removed."])
        for n in out.notes.map(\.text) {
            XCTAssertFalse(n.contains("\u{2014}"))
            XCTAssertFalse(n.lowercased().contains("you should"))
        }
    }

    @MainActor
    func testReconcileLeavesPastDaysMatchingCopiesAndUnlistedDaysAlone() async {
        let watch = FakeWatch()
        let mon = session("2026-11-02", "tempo", 45, row: "r0") // yesterday
        let tue = session("2026-11-03", "easy", 40, row: "r1")
        let far = session("2026-11-09", "long", 90, row: "r9")
        let ledger = sent([mon, tue, far], to: watch)
        // Yesterday's row is no longer listed, and the list (a full page) ends on Nov 8.
        let out = await WatchReconcile.run(workouts: [tue], coveredThrough: "2026-11-08", ledger: ledger, scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertEqual(watch.scheduled.map(\.at), [at6(2), at6(3), at6(9)], "nothing removed")
        XCTAssertNil(out.note(for: tue))
        // A copy sent before this device kept records still counts when its name matches.
        let older = FakeWatch()
        older.scheduled = [WatchCopy(name: tue.detail, at: at6(3))]
        _ = await WatchReconcile.run(workouts: [tue], coveredThrough: nil, ledger: WatchLedger(), scheduler: older, today: "2026-11-03", now: reconcileNow)
        XCTAssertEqual(older.scheduled.count, 1)
        XCTAssertNil(WatchReconcile.coveredThrough([tue]), "a short page is the whole plan")
    }

    @MainActor
    func testReconcileTouchesOnlyTheStaleCopyOnADayWithTwoSessions() async {
        let watch = FakeWatch()
        let run = session("2026-11-04", "easy", 40, row: "a")
        let ride = session("2026-11-04", "recovery", 30, row: "b", type: "ride")
        let ledger = sent([run, ride], to: watch)
        // The coach drops the ride; the run stays.
        let out = await WatchReconcile.run(workouts: [run], coveredThrough: nil, ledger: ledger, scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertEqual(watch.scheduled.map(\.name), [run.detail])
        XCTAssertEqual(out.sends.map(\.rowId), ["a"])
        // The day's note shows under the run, the row left on that day; it names neither as changed.
        XCTAssertEqual(out.notes.map(\.key), ["day:2026-11-04"])
        XCTAssertEqual(out.notes.first?.text, "One of Wed Nov 4's sessions is no longer on your plan, so its Watch copy was removed.")
    }

    @MainActor
    func testReconcileNeverAsksForWatchPermission() async {
        let watch = FakeWatch()
        let ledger = sent([session("2026-11-03", "tempo", 45, row: "r1")], to: watch)
        watch.allow = false
        let out = await WatchReconcile.run(workouts: [], coveredThrough: nil, ledger: ledger, scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertEqual(watch.scheduled.count, 1)
        XCTAssertEqual(out, ledger)
    }

    @MainActor
    func testTwoSameNameSessionsOnOneDayKeepTheirOwnCopies() async {
        // A coach plan with two easy 40s on Wednesday: same Watch name.
        let watch = FakeWatch()
        let am = session("2026-11-04", "easy", 40, row: "am")
        let pm = session("2026-11-04", "easy", 40, row: "pm")
        for w in [am, pm, am] {
            _ = await WatchSend.send(steps: w.steps!, type: w.type, date: w.date, displayName: w.detail, dayLabel: w.dayLabel,
                                     rowId: w.rowId, scheduler: watch, now: reconcileNow)
        }
        XCTAssertEqual(Set(watch.scheduled.map(\.id)), [WatchPlanId.forSession(rowId: "am"), WatchPlanId.forSession(rowId: "pm")])
        XCTAssertEqual(watch.scheduled.count, 2, "resending one replaced only its own copy")
        // The coach drops the evening session: only its copy goes.
        _ = await WatchReconcile.run(workouts: [am], coveredThrough: nil, ledger: WatchLedger(), scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertEqual(watch.scheduled.map(\.id), [WatchPlanId.forSession(rowId: "am")])
    }

    @MainActor
    func testANewPhoneStillMovesASessionItDidNotSend() async {
        // Sent from another phone: the Watch has the copy, this phone has no records.
        let watch = FakeWatch()
        _ = sent([session("2026-11-03", "tempo", 45, row: "r1")], to: watch)
        let wed = session("2026-11-04", "tempo", 45, row: "r1")
        let out = await WatchReconcile.run(workouts: [wed], coveredThrough: nil, ledger: WatchLedger(), scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertEqual(watch.scheduled.map(\.at), [at6(4)], "moved, not just removed")
        XCTAssertEqual(watch.scheduled.map(\.id), [WatchPlanId.forSession(rowId: "r1")])
        XCTAssertEqual(out.note(for: wed), "Moved from Tue Nov 3. Its Watch copy moved with it.")
        // Moved and changed from another phone: removed, not resent.
        let other = FakeWatch()
        _ = sent([session("2026-11-03", "tempo", 45, row: "r1")], to: other)
        let wedEasy = session("2026-11-04", "endurance", 45, row: "r1")
        _ = await WatchReconcile.run(workouts: [wedEasy], coveredThrough: nil, ledger: WatchLedger(), scheduler: other, today: "2026-11-03", now: reconcileNow)
        XCTAssertTrue(other.scheduled.isEmpty)
    }

    @MainActor
    func testCopiesFromOlderBuildsStillMatchByDayAndName() async {
        // Moved after an older build sent it: found by name and the record, resent under its id.
        let watch = FakeWatch()
        let ledger = sent([session("2026-11-03", "tempo", 45, row: "r1")], to: watch, olderBuild: true)
        let wed = session("2026-11-04", "tempo", 45, row: "r1")
        _ = await WatchReconcile.run(workouts: [wed], coveredThrough: nil, ledger: ledger, scheduler: watch, today: "2026-11-03", now: reconcileNow)
        XCTAssertEqual(watch.scheduled.map(\.at), [at6(4)])
        XCTAssertEqual(watch.scheduled.map(\.id), [WatchPlanId.forSession(rowId: "r1")])
        // Sending again replaces an older build's same-day copy by name, renamed or not.
        let older = FakeWatch()
        let tempoName = session("2026-11-04", "tempo", 45, row: "r1").detail
        older.scheduled = [WatchCopy(name: tempoName, at: at6(4))]
        let downgraded = session("2026-11-04", "endurance", 45, row: "r1")
        _ = await WatchSend.send(steps: downgraded.steps!, type: "run", date: downgraded.date, displayName: downgraded.detail, dayLabel: downgraded.dayLabel,
                                 rowId: "r1", replacing: tempoName, scheduler: older, now: reconcileNow)
        XCTAssertEqual(older.scheduled.map(\.name), [downgraded.detail])
    }

    func testWatchPlanIdIsAStableUUIDv5() {
        // RFC 4122 v5 of "www.example.com" in the DNS namespace.
        let dns = UUID(uuidString: "6ba7b810-9dad-11d1-80b4-00c04fd430c8")!
        XCTAssertEqual(WatchPlanId.uuid5(namespace: dns, name: "www.example.com").uuidString.lowercased(), "2ed6657d-e927-568b-95e1-2665a8aea6a2")
        XCTAssertEqual(WatchPlanId.forSession(rowId: "r1"), WatchPlanId.forSession(rowId: "r1"))
        XCTAssertNotEqual(WatchPlanId.forSession(rowId: "r1"), WatchPlanId.forSession(rowId: "r2"))
        XCTAssertTrue(WatchPlanId.isDerived(WatchPlanId.forSession(rowId: "r1")))
        XCTAssertFalse(WatchPlanId.isDerived(UUID()), "older builds sent random v4 ids")
    }

    func testWatchLedgerRemembersTheNameASessionWasSentUnder() {
        var ledger = WatchLedger()
        let tempo = session("2026-11-03", "tempo", 45, row: "r1")
        ledger.recordSend(tempo)
        XCTAssertEqual(ledger.lastSentName(session("2026-11-03", "endurance", 45, row: "r1")), tempo.detail)
        let defaults = UserDefaults(suiteName: "watch-ledger-test")!
        defer { defaults.removePersistentDomain(forName: "watch-ledger-test") }
        ledger.save(athleteId: "a1", defaults: defaults)
        XCTAssertEqual(WatchLedger.load(athleteId: "a1", defaults: defaults), ledger)
        XCTAssertEqual(WatchLedger.load(athleteId: "other", defaults: defaults), WatchLedger())
    }

    func testASessionWhoseDayHasPassedSaysSo() async {
        // The plan screen was left open overnight: yesterday's session still shows.
        let steps = [PlanStep(type: "steady", durationMin: 40, intensity: "easy", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        let watch = FakeWatch()
        let nextMorning = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 24, hour: 7))!
        let o = await WatchSend.send(steps: steps, type: "run", date: "2026-10-23", displayName: "x", dayLabel: "Fri Oct 23", scheduler: watch, now: nextMorning)
        XCTAssertEqual(o, .dayPassed("Fri Oct 23"))
        XCTAssertTrue(watch.scheduled.isEmpty)
        XCTAssertEqual(WatchSend.message(o), "Fri Oct 23 has passed, so this session was not sent.")
    }

    func testPushThatArrivesWithTheAppOpenIsShown() {
        // Without willPresent, iOS drops a push that lands while SCORA is open.
        let sel = #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))
        XCTAssertTrue(AppDelegate().responds(to: sel))
        XCTAssertTrue(PushPresentation.foreground.contains(.banner))
        XCTAssertTrue(PushPresentation.foreground.contains(.list))
    }

    func testSendToWatchCountsDaysAcrossTheDSTChange() {
        // New York leaves DST on Nov 1 2026; Nov 9 is 8 days after Nov 1, not 7.
        let saved = NSTimeZone.default
        NSTimeZone.default = TimeZone(identifier: "America/New_York")!
        defer { NSTimeZone.default = saved }
        let steps = [PlanStep(type: "steady", durationMin: 30, intensity: "easy", reps: nil, workDurationMin: nil, workIntensity: nil, restDurationMin: nil, restIntensity: nil)]
        XCTAssertFalse(WatchSend.canSend(type: "run", steps: steps, date: "2026-11-09", today: "2026-11-01"), "8 days out")
        XCTAssertTrue(WatchSend.canSend(type: "run", steps: steps, date: "2026-11-08", today: "2026-11-01"), "7 days out")
        XCTAssertTrue(WatchSend.canSend(type: "run", steps: steps, date: "2026-11-01", today: "2026-11-01"), "today")
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

    func testPastedRowsWithBlankDescriptionsKeepTheirOwnIds() throws {
        let json = #"{"workouts":[{"date":"2026-10-20","type":"run","description":""},{"date":"2026-10-20","type":"run","description":""}],"rejected":[]}"#
        let rows = try JSONDecoder().decode(PlanSaveResponse.self, from: Data(json.utf8)).workouts
        XCTAssertEqual(rows.count, 2)
        XCTAssertNotEqual(rows[0].id, rows[1].id)
        XCTAssertEqual(rows[0].id, rows[0].id, "the id is made once, not per read")
        var stored = rows[0]
        stored.rowId = "w1"
        XCTAssertEqual(stored.id, "w1")
    }

    func testBuildAsksBeforeReplacingAPlanThatDidNotLoad() {
        let w = PlanWorkout(date: "2026-10-20", type: "run", intensity: nil, durationMin: nil, distanceKm: nil, description: nil)
        XCTAssertTrue(PlanSheet.buildReplaces(loaded: false, workouts: []), "a failed load is not an empty plan")
        XCTAssertTrue(PlanSheet.buildReplaces(loaded: true, workouts: [w]))
        XCTAssertFalse(PlanSheet.buildReplaces(loaded: true, workouts: []))
        XCTAssertFalse(PlanSheet.loadFailed.contains("!"))
    }

    func testANewPlanClearsTheOldPlansExtras() throws {
        var extras = PlanExtras()
        extras.unmarked = [PlanWorkout(date: "2026-10-20", type: "run", intensity: nil, durationMin: nil, distanceKm: nil, description: nil)]
        extras.changes = [PlanAdaptation(id: "a", type: "moved", reason: "One.", triggeredAt: "2026-10-21T06:00:00.000Z")]
        extras.changesOn = true
        extras.prediction = try XCTUnwrap(try? JSONDecoder().decode(RacePrediction.self, from: Data(#"{"ok":true,"race":"half","low_s":5400,"high_s":5700}"#.utf8)))
        extras.clearForNewPlan()
        XCTAssertTrue(extras.unmarked.isEmpty)
        XCTAssertTrue(extras.changes.isEmpty)
        XCTAssertNil(extras.prediction)
        XCTAssertTrue(extras.changesOn, "the endpoint is still on")
    }

    func testRowRequestsGuardAndKeepErrorsWithTheirRow() {
        var r = PlanRowRequests()
        XCTAssertTrue(r.begin("a"))
        XCTAssertFalse(r.begin("a"), "a second tap waits for the first")
        XCTAssertTrue(r.isPending("a"))
        XCTAssertTrue(r.begin("b"))
        r.finish("a", error: PlanSheet.markFailed)
        XCTAssertFalse(r.isPending("a"))
        XCTAssertEqual(r.error(for: "a"), PlanSheet.markFailed)
        XCTAssertNil(r.error(for: "b"))
        XCTAssertTrue(r.begin("a"))
        XCTAssertNil(r.error(for: "a"), "a retry clears the old message")
        r.finish("a", error: nil)
        XCTAssertNil(r.error(for: "a"))
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

    // MARK: - Delivery time picker

    // Every minute of the day comes back as itself.
    func testDeliveryTimeRoundTripsEveryMinute() {
        for m in 0..<1440 {
            XCTAssertEqual(OnboardingState.deliveryMinute(from: OnboardingState.deliveryTime(minute: m)), m)
        }
        XCTAssertEqual(OnboardingState.deliveryMinute(from: OnboardingState.defaultDeliveryTime()), 360)
    }

    // On a daylight saving change day the phone's own clock skips 2:00 to 3:00
    // (spring) or runs 1:00 to 2:00 twice (fall). The picker edits a plain
    // time of day, so 2:30 is 150 and 1:30 is 90, whatever day and zone the
    // phone is in.
    func testDeliveryTimeIgnoresTheDSTChangeDayInThePhonesZone() throws {
        let savedZone = NSTimeZone.default
        defer { NSTimeZone.default = savedZone }
        let changes: [(String, DateComponents)] = [
            ("America/New_York", DateComponents(year: 2026, month: 3, day: 8)),
            ("America/New_York", DateComponents(year: 2026, month: 11, day: 1)),
            ("Europe/London", DateComponents(year: 2026, month: 3, day: 29)),
            ("Australia/Sydney", DateComponents(year: 2026, month: 10, day: 4)),
        ]
        for (id, day) in changes {
            let zone = try XCTUnwrap(TimeZone(identifier: id))
            NSTimeZone.default = zone
            var local = Calendar(identifier: .gregorian)
            local.timeZone = zone
            // Sanity: the day really is a change day in that zone.
            let start = try XCTUnwrap(local.date(from: day))
            XCTAssertNotEqual(zone.secondsFromGMT(for: start), zone.secondsFromGMT(for: start.addingTimeInterval(86_400)), id)
            for m in [0, 60, 90, 120, 150, 179, 180, 210, 360, 1439] {
                XCTAssertEqual(OnboardingState.deliveryMinute(from: OnboardingState.deliveryTime(minute: m)), m, "\(id) \(m)")
            }
        }
    }

    // A 12-hour and a 24-hour locale send the same minute, and the picker's
    // wall clock reads the same time in each.
    func testDeliveryTimeInTwelveAndTwentyFourHourLocales() {
        let t = OnboardingState.deliveryTime(minute: 18 * 60 + 30)
        for id in ["en_US", "en_GB", "de_DE", "ja_JP", "ar_EG"] {
            var cal = OnboardingState.pickerCalendar
            cal.locale = Locale(identifier: id)
            XCTAssertEqual(OnboardingState.deliveryMinute(from: t, calendar: cal), 1110, id)
        }
        let f = DateFormatter()
        f.timeZone = OnboardingState.pickerCalendar.timeZone
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = DateFormatter.dateFormat(fromTemplate: "jmm", options: 0, locale: f.locale)
        let us = f.string(from: t)
        XCTAssertTrue(us.hasPrefix("6:30") && us.hasSuffix("PM"), us)
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = DateFormatter.dateFormat(fromTemplate: "jmm", options: 0, locale: f.locale)
        XCTAssertEqual(f.string(from: t), "18:30")
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

    // Signing out and back in: the API already has onboarded_at, so the
    // athlete goes straight to the dashboard. No real network: the transport
    // is a stub.
    func testSignInSkipsOnboardingWhenTheAPISaysItIsDone() async {
        // a1 is the athlete signed in, so the API's answer applies to them.
        let signedIn = UserDefaults.standard.string(forKey: "scora.athleteId")
        UserDefaults.standard.set("a1", forKey: "scora.athleteId")
        defer { UserDefaults.standard.set(signedIn, forKey: "scora.athleteId") }
        let saved = OnboardingSync.transport
        defer { OnboardingSync.transport = saved; OnboardingSync.pending = nil; OnboardingState.needsOnboarding = false }
        OnboardingSync.pending = nil
        var asked: [URLRequest] = []
        var answer: (Int, Data)? = (200, Data(#"{"timezone":"America/New_York","deliveryMinute":390,"onboarded":true}"#.utf8))
        OnboardingSync.transport = { req in asked.append(req); return answer }

        OnboardingState.needsOnboarding = true
        let tm = TokenManager()
        await tm.refreshOnboarding(athleteId: "a1")
        XCTAssertFalse(tm.needsOnboarding, "finished on the server: no second onboarding")
        XCTAssertFalse(OnboardingState.needsOnboarding)
        XCTAssertEqual(asked.last?.httpMethod ?? "GET", "GET")
        XCTAssertEqual(asked.last?.url?.path, "/api/preferences")
        XCTAssertTrue(asked.last?.url?.query?.contains("athleteId=a1") ?? false)

        // A new athlete, or no answer at all, still goes through onboarding.
        for reply in [(200, Data(#"{"onboarded":false}"#.utf8)), nil, (500, Data())] as [(Int, Data)?] {
            answer = reply
            OnboardingState.needsOnboarding = true
            let fresh = TokenManager()
            await fresh.refreshOnboarding(athleteId: "a1")
            XCTAssertTrue(fresh.needsOnboarding)
            XCTAssertFalse(fresh.checkingOnboarding)
        }

        // People already past onboarding are never asked about.
        asked = []
        OnboardingState.needsOnboarding = false
        await TokenManager().refreshOnboarding(athleteId: "a1")
        XCTAssertTrue(asked.isEmpty)
    }

    // "Skip for now" after a failed save: the choice stays on the phone and is
    // sent again until the API takes it.
    func testSkippedOnboardingChoiceIsKeptUntilTheAPIAcceptsIt() async throws {
        // a1 is the athlete signed in, so the API's answer applies to them.
        let signedIn = UserDefaults.standard.string(forKey: "scora.athleteId")
        UserDefaults.standard.set("a1", forKey: "scora.athleteId")
        defer { UserDefaults.standard.set(signedIn, forKey: "scora.athleteId") }
        let saved = OnboardingSync.transport
        defer { OnboardingSync.transport = saved; OnboardingSync.pending = nil; OnboardingState.needsOnboarding = false; TimeZoneSync.forget() }
        var sent: [URLRequest] = []
        var status: Int? = nil
        OnboardingSync.transport = { req in sent.append(req); return status.map { ($0, Data()) } }

        OnboardingSync.keep(PendingOnboarding(athleteId: "a1", timezone: "Europe/London", deliveryMinute: 420))
        XCTAssertEqual(OnboardingSync.pending?.deliveryMinute, 420)

        let offline = await OnboardingSync.flush(athleteId: "a1")
        XCTAssertFalse(offline)
        status = 503
        let down = await OnboardingSync.flush(athleteId: "a1")
        XCTAssertFalse(down)
        XCTAssertNotNil(OnboardingSync.pending, "kept while the API is unreachable")

        // While it waits, signing in again does not repeat onboarding.
        OnboardingState.needsOnboarding = true
        let tm = TokenManager()
        await tm.refreshOnboarding(athleteId: "a1")
        XCTAssertFalse(tm.needsOnboarding)

        status = 200
        sent = []
        let ok = await OnboardingSync.flush(athleteId: "a1")
        XCTAssertTrue(ok)
        XCTAssertNil(OnboardingSync.pending)
        let req = try XCTUnwrap(sent.first)
        XCTAssertEqual(req.httpMethod, "PUT")
        XCTAssertEqual(req.url?.path, "/api/preferences")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: req.httpBody ?? Data()) as? [String: Any])
        XCTAssertEqual(body["athleteId"] as? String, "a1")
        XCTAssertEqual(body["timezone"] as? String, "Europe/London")
        XCTAssertEqual(body["deliveryMinute"] as? Int, 420)
        XCTAssertEqual(body["onboarded"] as? Bool, true)
        XCTAssertFalse(TimeZoneSync.needsSync(current: "Europe/London"), "the zone sent is remembered")

        // Nothing waiting: nothing sent.
        sent = []
        _ = await OnboardingSync.flush(athleteId: "a1")
        XCTAssertTrue(sent.isEmpty)

        // Another athlete signing in on this phone never sends the first one's choice.
        OnboardingSync.keep(PendingOnboarding(athleteId: "a1", timezone: "Europe/London", deliveryMinute: 420))
        _ = await OnboardingSync.flush(athleteId: "b2")
        XCTAssertTrue(sent.isEmpty)
        XCTAssertNil(OnboardingSync.pending)

        // A refusal for good (400) is dropped, not retried forever.
        OnboardingSync.keep(PendingOnboarding(athleteId: "a1", timezone: "Europe/London", deliveryMinute: 420))
        status = 400
        _ = await OnboardingSync.flush(athleteId: "a1")
        XCTAssertNil(OnboardingSync.pending)
    }

    // A refusal the API will give every time (404, 422) is dropped like a 400,
    // so it is not resent on every launch. A busy or slow API (408, 429, 5xx)
    // keeps it. The send is short, so the sign-in wait screen cannot sit for
    // the system's 60 second default.
    func testSkippedOnboardingRetryDropsPermanentRefusalsAndIsShort() async throws {
        let saved = OnboardingSync.transport
        defer { OnboardingSync.transport = saved; OnboardingSync.pending = nil; TimeZoneSync.forget() }
        var sent: [URLRequest] = []
        var status = 0
        OnboardingSync.transport = { req in sent.append(req); return (status, Data()) }
        let choice = PendingOnboarding(athleteId: "a1", timezone: "Europe/London", deliveryMinute: 420)

        for code in [404, 409, 413, 422] {
            OnboardingSync.keep(choice)
            status = code
            let done = await OnboardingSync.flush(athleteId: "a1")
            XCTAssertTrue(done, "\(code)")
            XCTAssertNil(OnboardingSync.pending, "\(code) is final")
        }
        for code in [408, 429, 500, 503] {
            OnboardingSync.keep(choice)
            status = code
            let done = await OnboardingSync.flush(athleteId: "a1")
            XCTAssertFalse(done, "\(code)")
            XCTAssertEqual(OnboardingSync.pending, choice, "\(code) is retried")
        }
        let req = try XCTUnwrap(sent.last)
        XCTAssertLessThanOrEqual(req.timeoutInterval, 10)
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


    // MARK: - Onboarding, chat and weekly review (correctness pass)

    func testOnboardingAdvancesOnlyFromTheStepThatAsked() {
        // A second tap on "Allow Apple Health" must not skip the plan step.
        XCTAssertEqual(OnboardingStep.health.advanced(from: .health), .plan)
        XCTAssertEqual(OnboardingStep.plan.advanced(from: .health), .plan)
        XCTAssertEqual(OnboardingStep.done.advanced(from: .done), .done)
    }

    func testOnboardingProgressHasASpokenLabel() {
        XCTAssertEqual(OnboardingStep.oura.progressLabel, "Step 1 of 5")
        XCTAssertEqual(OnboardingStep.done.progressLabel, "Step 5 of 5")
    }

    func testChatLimitPlaceholderUsesNoDash() {
        XCTAssertFalse(ChatCopy.limitPlaceholder.contains("\u{2014}"))
        XCTAssertFalse(ChatCopy.limitPlaceholder.contains("\u{2013}"))
        XCTAssertFalse(ChatCopy.limitPlaceholder.contains("!"))
    }

    func testCDVResponseWithoutDriversDecodes() throws {
        let r = try decode(#"{"voice":"Load is steady."}"#)
        XCTAssertTrue(r.drivers.isEmpty)
    }

    func testDriverWithNumericValueDecodes() throws {
        let r = try decode(#"{"voice":"x","drivers":[{"metric":"HRV","value":52}]}"#)
        XCTAssertEqual(r.drivers.first?.value, "52")
    }

    func testMalformedCDVReplyShowsAFixedLine() {
        let html = CDVReply.message(from: Data("<html>502</html>".utf8))
        XCTAssertFalse(html.isUser)
        XCTAssertEqual(html.text, CDVReply.unreadable)
        XCTAssertEqual(CDVReply.message(from: Data(#"{"voice":"  ","drivers":[]}"#.utf8)).text, CDVReply.unreadable)
        XCTAssertEqual(CDVReply.message(from: Data(#"{"voice":"Load is steady."}"#.utf8)).text, "Load is steady.")
    }

    func testWeeklyResponseWithoutStatsDecodes() throws {
        let r = try JSONDecoder().decode(WeeklyResponse.self, from: Data(#"{"read":{"voice":"A steady week."}}"#.utf8))
        XCTAssertTrue(r.stats.isEmpty)
    }

    func testWeeklyDecodeFailureIsNotShownRaw() {
        let err = DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "bad"))
        XCTAssertEqual(WeeklyText.failure(err), WeeklyText.unreadable)
        XCTAssertEqual(WeeklyText.failure(URLError(.notConnectedToInternet)), NetworkText.weekly.offline)
    }

}

// Chart summaries for VoiceOver: built only from the values the chart draws.
final class ChartAccessibilitySummaryTests: XCTestCase {
    private let utc = TimeZone(identifier: "UTC")!

    func testDriverSeriesSummaryReadsTheDrawnPoints() {
        let s = DriverSeries(key: "hrv", label: "HRV, nightly average", unit: "ms",
                             points: [SeriesPoint(date: "2026-10-16", value: 44),
                                      SeriesPoint(date: "2026-10-17", value: 41),
                                      SeriesPoint(date: "2026-10-18", value: 52)],
                             baseline: 46.5)
        XCTAssertEqual(s.accessibilitySummary(zone: utc),
                       "3 recorded values, October 16 to October 18. Latest 52 ms. Low 41 ms, high 52 ms. Average before: 46.5 ms.")
    }

    func testDriverSeriesSummaryLeavesOutDaysTheChartCannotPlace() {
        let s = DriverSeries(key: "sleep", label: "Hours slept", unit: "h",
                             points: [SeriesPoint(date: "not a day", value: 9), SeriesPoint(date: "2026-10-18", value: 7.2)],
                             baseline: nil, baselineLabel: "last week")
        XCTAssertEqual(s.accessibilitySummary(zone: utc), "1 recorded value. Latest 7:12.")
    }

    func testDriverSeriesSummaryUsesTheServersBaselineName() {
        let s = DriverSeries(key: "load", label: "Run minutes", unit: "min",
                             points: [SeriesPoint(date: "2026-10-17", value: 400), SeriesPoint(date: "2026-10-18", value: 412)],
                             baseline: 380, baselineLabel: "last week")
        XCTAssertTrue(s.accessibilitySummary(zone: utc).hasSuffix("Last week: 380 min."))
    }

    func testDriverSeriesSummaryWithNoPoints() {
        let s = DriverSeries(key: "hrv", label: "HRV", unit: "ms", points: [], baseline: nil)
        XCTAssertEqual(s.accessibilitySummary(zone: utc), "No recorded values.")
    }

    func testCDVSummaryReadsTheSpecsOwnValues() {
        let values: [JSONValue] = [41, 44, 43, 52].enumerated().map { i, v in
            .object(["week": .number(Double(i + 1)), "hrv": .number(Double(v))])
        }
        let spec = JSONValue.object([
            "mark": .string("line"),
            "data": .object(["values": .array(values)]),
            "encoding": .object([
                "x": .object(["field": .string("week"), "type": .string("ordinal"), "title": .string("Week")]),
                "y": .object(["field": .string("hrv"), "type": .string("quantitative"), "title": .string("HRV (ms)")]),
            ]),
        ])
        XCTAssertEqual(CDVChart.summary(for: spec),
                       "HRV (ms) by Week. 4 values, from 1 to 4. First 41, last 52. Low 41, high 52.")
    }

    func testCDVSummaryDeclinesShapesItCannotReadExactly() {
        let rows: JSONValue = .array([.object(["d": .string("Mon"), "v": .number(3)])])
        let aggregated = JSONValue.object([
            "data": .object(["values": rows]),
            "encoding": .object(["y": .object(["field": .string("v"), "aggregate": .string("sum")])]),
        ])
        XCTAssertNil(CDVChart.summary(for: aggregated))
        let colored = JSONValue.object([
            "data": .object(["values": rows]),
            "encoding": .object(["y": .object(["field": .string("v")]), "color": .object(["field": .string("d")])]),
        ])
        XCTAssertNil(CDVChart.summary(for: colored))
        XCTAssertNil(CDVChart.summary(for: .object(["data": .object(["url": .string("x")])])))
    }

    func testCDVReplyCarriesTheSummaryWithTheChart() throws {
        let json = #"{"voice":"HRV rose.","drivers":[],"chart":{"mark":"bar","data":{"values":[{"d":"Mon","v":3},{"d":"Tue","v":5.5}]},"encoding":{"x":{"field":"d"},"y":{"field":"v","title":"Runs"}}}}"#
        let msg = CDVReply.message(from: Data(json.utf8))
        XCTAssertNotNil(msg.chartHTML)
        XCTAssertEqual(msg.chartSummary, "Runs by d. 2 values, from Mon to Tue. First 3, last 5.5. Low 3, high 5.5.")
    }
}
