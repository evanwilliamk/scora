import XCTest
@testable import Scora

// Dashboard correctness: cards, loads, and what VoiceOver hears.
final class DashboardReviewTests: XCTestCase {

  private func card(_ id: String, available: Bool = true, value: String? = nil, unit: String? = nil,
                    translation: String? = nil, trend: String? = nil, source: String? = nil, cta: String? = nil) -> DashboardCard {
    DashboardCard(id: id, title: id.capitalized, available: available, value: value, unit: unit,
                  translation: translation, trend: trend, source: source, cta: cta)
  }

  // Oura linked but no night recorded: the card says so and does not send
  // the athlete through Oura sign-in again.
  func testOuraConnectOnlyWhenTheCardAsksForIt() {
    let unlinked = card("sleep", available: false, source: "Oura / Apple Health",
                        cta: "Connect Oura or Apple Health to read your sleep.")
    let linkedNoNight = card("sleep", available: false, source: "Oura / Apple Health",
                             cta: "No sleep recorded last night.")
    let linkedNoHrv = card("recovery_signal", available: false, source: "Oura", cta: "No HRV recorded last night.")
    let strava = card("training_load", available: false, source: "Strava", cta: "No runs in the last two weeks.")
    XCTAssertTrue(unlinked.offersOuraConnect)
    XCTAssertFalse(linkedNoNight.offersOuraConnect)
    XCTAssertFalse(linkedNoHrv.offersOuraConnect)
    XCTAssertFalse(strava.offersOuraConnect)
    XCTAssertFalse(card("sleep", value: "7:12", unit: "hrs", source: "Oura").offersOuraConnect)
  }

  private func decode(_ json: String) throws -> DashboardCard {
    try JSONDecoder().decode(DashboardCard.self, from: Data(json.utf8))
  }

  // The API's explicit connect flag decodes in three states.
  func testConnectFlagDecode() throws {
    let base = #""id":"sleep","title":"Sleep","available":false,"source":"Oura / Apple Health""#
    XCTAssertEqual(try decode("{\(base),\"connect\":\"oura\"}").connect, .source("oura"))
    XCTAssertEqual(try decode("{\(base),\"connect\":null}").connect, .none)
    XCTAssertEqual(try decode("{\(base)}").connect, .absent)
    XCTAssertEqual(try decode("{\(base),\"connect\":7}").connect, .none)
  }

  // The flag wins over the prompt text; an older API falls back to the text.
  func testConnectFlagDecidesOuraConnect() throws {
    let flagged = try decode(#"{"id":"sleep","title":"Sleep","available":false,"source":"Oura / Apple Health","cta":"Connect Oura or Apple Health to read your sleep.","connect":"oura"}"#)
    XCTAssertTrue(flagged.offersOuraConnect)
    XCTAssertEqual(flagged.tapKind, .connectOura)
    // Linked, no data tonight: null, even if the text were to start with "Connect".
    let linked = try decode(#"{"id":"sleep","title":"Sleep","available":false,"source":"Oura","cta":"Connect later.","connect":null}"#)
    XCTAssertFalse(linked.offersOuraConnect)
    // Flag set although the text no longer starts with "Connect".
    let reworded = try decode(#"{"id":"recovery_signal","title":"Recovery Signal","available":false,"source":"Oura","cta":"Link Oura to read HRV.","connect":"oura"}"#)
    XCTAssertTrue(reworded.offersOuraConnect)
    XCTAssertFalse(try decode(#"{"id":"training_load","title":"Training Load","available":false,"source":"Strava","connect":"strava"}"#).offersOuraConnect)
    // Older API: no flag, text check.
    let legacy = try decode(#"{"id":"sleep","title":"Sleep","available":false,"source":"Oura","cta":"Connect Oura to read HRV."}"#)
    XCTAssertTrue(legacy.offersOuraConnect)
    let legacyLinked = try decode(#"{"id":"sleep","title":"Sleep","available":false,"source":"Oura","cta":"No sleep recorded last night."}"#)
    XCTAssertFalse(legacyLinked.offersOuraConnect)
  }

  // Long Effort run today comes with an empty unit: nothing is drawn for it.
  func testEmptyUnitIsNotShown() {
    XCTAssertNil(card("long_effort", value: "Today", unit: "").shownUnit)
    XCTAssertNil(card("long_effort", value: "Today", unit: nil).shownUnit)
    XCTAssertEqual(card("sleep", value: "7:12", unit: "hrs").shownUnit, "hrs")
  }

  // One spoken line per card, built from the API's own strings.
  func testCardSpokenLabel() {
    let sleep = card("sleep", value: "7:12", unit: "hrs", trend: "Oura 84", source: "Oura")
    XCTAssertEqual(sleep.spokenLabel, "Sleep, 7:12 hrs, Oura 84. From Oura.")
    let today = card("long_effort", value: "Today", unit: "", trend: "8.2 mi", source: "Strava")
    XCTAssertEqual(today.spokenLabel, "Long_Effort, Today, 8.2 mi. From Strava.")
    let off = card("recovery_signal", available: false, source: "Oura", cta: "Connect Oura to read HRV and resting heart rate.")
    XCTAssertEqual(off.spokenLabel, "Recovery_Signal, Connect Oura to read HRV and resting heart rate. From Oura.")
    let bare = card("x", available: false)
    XCTAssertEqual(bare.spokenLabel, "X, Not available yet.")
  }

  // Tap-to-expand only where there is something to expand.
  func testCardTapKinds() {
    XCTAssertEqual(card("sleep", available: false, source: "Oura", cta: "Connect Oura to read HRV.").tapKind, .connectOura)
    XCTAssertEqual(card("sleep", value: "7:12", translation: "Slept 7:12.").tapKind, .expand)
    XCTAssertEqual(card("connections", value: "1").tapKind, .none)
    XCTAssertEqual(card("training_load", available: false, source: "Strava", cta: "No runs.").tapKind, .none)
  }

  // Two loads in flight: only the newest one's reply lands.
  func testOnlyTheNewestReadLoadApplies() {
    var gate = ReadLoadGate()
    let first = gate.begin()
    let second = gate.begin()
    XCTAssertFalse(gate.isLatest(first))
    XCTAssertTrue(gate.isLatest(second))
  }

  // The newer load fails (offline, cancelled pull to refresh) after an older
  // one already answered: the older reply was the only read, so it lands.
  // A reply older than one already shown never puts earlier numbers back.
  func testOlderReplyLandsUnlessANewerOneAlreadyDid() {
    var gate = ReadLoadGate()
    let first = gate.begin()
    let second = gate.begin()
    XCTAssertTrue(gate.accept(first), "nothing newer has landed yet")
    XCTAssertFalse(gate.isLatest(first), "the spinner stays for the load still in flight")
    XCTAssertTrue(gate.accept(second))

    let third = gate.begin()
    let fourth = gate.begin()
    XCTAssertTrue(gate.accept(fourth))
    XCTAssertFalse(gate.accept(third), "late and older than what is shown")
  }

  // A refresh that fails while a read is on screen keeps the read and says so,
  // with the same line, never a second "pull to refresh" under the error.
  func testFailedRefreshNotice() {
    XCTAssertEqual(ReadStatus.of(hasRead: true, isLoading: false, error: "The read could not load. Pull to try again."),
                   .staleWithError("The read could not load. Pull to try again."))
    XCTAssertEqual(ReadStatus.of(hasRead: true, isLoading: false, error: nil), .shown)
    XCTAssertEqual(ReadStatus.of(hasRead: false, isLoading: true, error: nil), .loading)
    XCTAssertEqual(ReadStatus.of(hasRead: false, isLoading: false, error: "Down."), .error("Down."))
    XCTAssertEqual(ReadStatus.of(hasRead: false, isLoading: false, error: nil), .empty)
  }

  // A pull to refresh cut short (gesture ended early, view went away) is not a
  // failure: no error line over a read that is fine. A real failure still says so.
  func testCancelledRefreshShowsNoErrorLine() async {
    let cancelled = await ReadFetch.run { throw CancellationError() }
    XCTAssertEqual(cancelled, .cancelled)
    XCTAssertNil(cancelled.errorLine)
    XCTAssertEqual(ReadStatus.of(hasRead: true, isLoading: false, error: cancelled.errorLine), .shown)

    let urlCancelled = await ReadFetch.run { throw URLError(.cancelled) }
    XCTAssertEqual(urlCancelled, .cancelled)
    XCTAssertNil(urlCancelled.errorLine)
    XCTAssertEqual(ReadStatus.of(hasRead: true, isLoading: false, error: urlCancelled.errorLine), .shown)

    let offline = await ReadFetch.run { throw URLError(.notConnectedToInternet) }
    XCTAssertEqual(offline, .failed(ReadFetch.failureLine))
    XCTAssertEqual(ReadStatus.of(hasRead: true, isLoading: false, error: offline.errorLine),
                   .staleWithError(ReadFetch.failureLine))
  }

  // A 200 hands the body on; any other status is a failure with the server's line.
  func testReadFetchStatusHandling() async {
    let url = URL(string: "https://example.invalid/api/read")!
    let ok = await ReadFetch.run {
      (Data("{}".utf8), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    XCTAssertEqual(ok, .data(Data("{}".utf8)))
    let down = await ReadFetch.run {
      (Data(#"{"error":"Down for a minute."}"#.utf8), HTTPURLResponse(url: url, statusCode: 503, httpVersion: nil, headerFields: nil)!)
    }
    XCTAssertEqual(down, .failed("Down for a minute."))
  }

  // Week So Far speaks full day names and counts minutes correctly.
  func testWeekSoFarSpokenLabels() {
    XCTAssertEqual(WeekSoFarDay(date: "2026-10-26", weekday: "Mon", runMin: 1).spokenLabel, "Monday, 1 minute")
    XCTAssertEqual(WeekSoFarDay(date: "2026-10-27", weekday: "Tue", runMin: 0).spokenLabel, "Tuesday, no run")
    XCTAssertEqual(WeekSoFarDay(date: "2026-10-28", weekday: "Wed", runMin: 40, plannedMin: 45).spokenLabel,
                   "Wednesday, 40 minutes, plan 45 minutes")
    XCTAssertEqual(WeekSoFarDay(date: "2026-10-29", weekday: "Thu", runMin: nil, plannedMin: 0).spokenLabel, "Thursday, still ahead")
    XCTAssertEqual(WeekSoFarDay(date: "2026-10-30", weekday: "Fri", runMin: nil, plannedMin: 1).spokenLabel,
                   "Friday, still ahead, plan 1 minute")
  }

  func testDashboardCopyHasNoExclamationOrEmoji() {
    let lines = [ReadStatus.emptyLine, ReadStatus.loadingLine, DashboardCard.connectOuraLine, DashboardCard.unavailableLine]
    for line in lines {
      XCTAssertFalse(line.contains("!"), line)
      XCTAssertFalse(line.unicodeScalars.contains { $0.properties.isEmojiPresentation }, line)
      XCTAssertFalse(line.contains("\u{2014}"), line)
    }
  }
}
