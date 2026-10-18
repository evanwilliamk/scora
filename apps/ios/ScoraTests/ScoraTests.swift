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
    }

    func testSkippedNote() {
        XCTAssertNil(PlanDay.skippedNote(0))
        XCTAssertEqual(PlanDay.skippedNote(1), "1 line could not be read and was left out.")
        XCTAssertEqual(PlanDay.skippedNote(3), "3 lines could not be read and were left out.")
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
