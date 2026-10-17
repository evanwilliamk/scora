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
