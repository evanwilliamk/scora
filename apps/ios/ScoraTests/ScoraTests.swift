//
//  ScoraTests.swift
//  ScoraTests
//
//  Created by everett kosowski on 7/2/26.
//

import XCTest
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

    func testReadWithoutChartsStillDecodes() throws {
        let json = #"{"read":{"voice":"Plain read."},"cards":[],"generatedAt":null}"#.data(using: .utf8)!
        let r = try JSONDecoder().decode(ReadResponse.self, from: json)
        XCTAssertNil(r.read.links)
        XCTAssertEqual(String(ReadText.attributed(r.read.voice, links: [], series: [:]).characters), "Plain read.")
    }

    func testSkippedNote() {
        XCTAssertNil(PlanDay.skippedNote(0))
        XCTAssertEqual(PlanDay.skippedNote(1), "1 line could not be read and was left out.")
        XCTAssertEqual(PlanDay.skippedNote(3), "3 lines could not be read and were left out.")
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
