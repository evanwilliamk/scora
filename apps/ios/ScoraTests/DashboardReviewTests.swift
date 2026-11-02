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

  // A Longest Run (30d) run today comes with an empty unit: nothing is drawn for it.
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
    // The API's own title for the longest-run card (Q31 B): never "long effort".
    let longest = try? decode(#"{"id":"long_effort","title":"Longest Run (30d)","available":true,"value":"2","unit":"days ago","trend":"8 mi","source":"Strava"}"#)
    XCTAssertEqual(longest?.spokenLabel, "Longest Run (30d), 2 days ago, 8 mi. From Strava.")
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
    XCTAssertEqual(offline, .failed(NetworkText.read.offline))
    XCTAssertEqual(ReadStatus.of(hasRead: true, isLoading: false, error: offline.errorLine),
                   .staleWithError(NetworkText.read.offline))
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

// A URLProtocol that answers every request with a canned failure, or never.
final class StubURLProtocol: URLProtocol {
  enum Behavior { case fail(URLError.Code), hang }
  static var behavior: Behavior = .fail(.notConnectedToInternet)

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    switch Self.behavior {
    case .fail(let code): client?.urlProtocol(self, didFailWithError: URLError(code))
    case .hang: break // the session's own timeout ends it
    }
  }
  override func stopLoading() {}
}

// Offline, a slow network, and what each screen says and does about it.
final class OfflineReviewTests: XCTestCase {
  private let url = URL(string: "https://example.invalid/api/read")!

  // Quick calls give up at 15 s. Calls that wait on the server's Strava (15 s),
  // Oura (20 s) and OpenAI (20 s) chain must outlast it, and an offline phone
  // fails at once instead of waiting for a route.
  func testAPISessionTimeoutsMatchServerCaps() {
    XCTAssertEqual(API.session.configuration.timeoutIntervalForRequest, 15)
    XCTAssertGreaterThanOrEqual(API.slowSession.configuration.timeoutIntervalForRequest, 15 + 20 + 20)
    XCTAssertLessThanOrEqual(API.slowSession.configuration.timeoutIntervalForResource, 120)
    XCTAssertFalse(API.session.configuration.waitsForConnectivity)
    XCTAssertFalse(API.slowSession.configuration.waitsForConnectivity)
  }

  func testOfflineReadSaysOfflineInPlainWords() async {
    StubURLProtocol.behavior = .fail(.notConnectedToInternet)
    let session = API.make(timeout: 5, protocolClasses: [StubURLProtocol.self])
    let req = URLRequest(url: url)
    let outcome = await ReadFetch.run { try await session.data(for: req) }
    XCTAssertEqual(outcome, .failed(NetworkText.read.offline))
  }

  // A request the server never answers ends at the session's timeout with
  // its own line, not a minute of spinner and the system's error text.
  func testHungReadTimesOutWithItsOwnLine() async {
    StubURLProtocol.behavior = .hang
    let session = API.make(timeout: 0.5, protocolClasses: [StubURLProtocol.self])
    let req = URLRequest(url: url)
    let started = Date()
    let outcome = await ReadFetch.run { try await session.data(for: req) }
    XCTAssertEqual(outcome, .failed(NetworkText.read.timedOut))
    XCTAssertLessThan(Date().timeIntervalSince(started), 10)
  }

  func testFailuresNeverShowSystemErrorText() {
    let codes: [URLError.Code] = [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .secureConnectionFailed]
    for code in codes {
      let raw = URLError(code).localizedDescription
      XCTAssertNotEqual(WeeklyText.failure(URLError(code)), raw)
      for lines in NetworkText.every { XCTAssertNotEqual(lines.line(for: URLError(code)), raw) }
    }
    XCTAssertEqual(NetworkFailure.of(URLError(.cannotFindHost)), .other)
    XCTAssertEqual(NetworkFailure.of(URLError(.dataNotAllowed)), .offline)
    XCTAssertEqual(WeeklyText.failure(URLError(.timedOut)), NetworkText.weekly.timedOut)
  }

  // A question that never reached the server is not lost: it goes back in
  // the box, unless the athlete has already started typing another.
  func testChatNetworkFailureKeepsTheQuestion() {
    let offline = CDVFailure.after(URLError(.notConnectedToInternet), question: "How was my week?", input: "")
    XCTAssertEqual(offline.bubble, NetworkText.chat.offline)
    XCTAssertEqual(offline.input, "How was my week?")
    let typing = CDVFailure.after(URLError(.timedOut), question: "How was my week?", input: "And sleep?")
    XCTAssertEqual(typing.bubble, NetworkText.chat.timedOut)
    XCTAssertEqual(typing.input, "And sleep?")
  }

  // CLAUDE.md 3.2: a read from another day never sits under "Today's Read".
  func testReadFromAnotherDaySaysItsDate() {
    XCTAssertEqual(ReadDate.heading(loadedDay: "2026-11-01", today: "2026-11-01"), "Today's Read")
    XCTAssertEqual(ReadDate.heading(loadedDay: nil, today: "2026-11-01"), "Today's Read")
    XCTAssertEqual(ReadDate.heading(loadedDay: "2026-10-31", today: "2026-11-01"), "Read for Saturday, October 31")
    XCTAssertTrue(ReadDate.isOld(loadedDay: "2026-10-31", today: "2026-11-01"))
    XCTAssertFalse(ReadDate.isOld(loadedDay: "2026-11-01", today: "2026-11-01"))
  }

  // An earlier day's read (kept on the phone, or a refresh that failed past
  // midnight) is that day's: its "Today:" plan line and Plan today card were
  // that day's session, so they are not shown as today's.
  func testOlderReadDropsItsTodayLines() {
    let line = "Today: 45-minute tempo."
    XCTAssertEqual(ReadDate.todayLine(line, loadedDay: "2026-11-01", today: "2026-11-01"), line)
    XCTAssertNil(ReadDate.todayLine(line, loadedDay: "2026-10-31", today: "2026-11-01"))

    let plan = DashboardCard(id: "plan_today", title: "Plan today", available: true, value: "45", unit: "min",
                             translation: "On your plan today: tempo, 45 min.", trend: "tempo", source: "Your plan", cta: nil)
    let sleep = DashboardCard(id: "sleep", title: "Sleep", available: true, value: "7:12", unit: nil,
                              translation: "Sleep held.", trend: nil, source: "Oura", cta: nil)
    XCTAssertEqual(ReadDate.cards([sleep, plan], loadedDay: "2026-11-01", today: "2026-11-01").map(\.id), ["sleep", "plan_today"])
    XCTAssertEqual(ReadDate.cards([sleep, plan], loadedDay: "2026-10-31", today: "2026-11-01").map(\.id), ["sleep"])
  }

  // A reply that lands after the phone changed hands (sign-out, another
  // athlete signed in) is never kept under the athlete now signed in.
  func testReadIsKeptOnlyForTheAthleteWhoAskedForIt() {
    let file = tempCache()
    let body = Data(#"{"read":{"voice":"Body is settled."},"cards":[]}"#.utf8)
    let saved = Date(timeIntervalSince1970: 1_793_000_000)
    ReadCache.save(body, day: "2026-10-31", athleteId: "a1", signedIn: "a2", at: saved, to: file)
    XCTAssertNil(ReadCache.load(athleteId: "a1", now: saved, from: file))
    XCTAssertNil(ReadCache.load(athleteId: "a2", now: saved, from: file))
    ReadCache.save(body, day: "2026-10-31", athleteId: "a1", signedIn: "", at: saved, to: file)
    XCTAssertNil(ReadCache.load(athleteId: "a1", now: saved, from: file), "signed out meanwhile")
    ReadCache.save(body, day: "2026-10-31", athleteId: "a1", signedIn: "a1", at: saved, to: file)
    XCTAssertNotNil(ReadCache.load(athleteId: "a1", now: saved, from: file))
    ReadCache.clear(at: file)
  }

  private func tempCache() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("read-cache-\(UUID().uuidString)/last-read.json")
  }

  // Cold launch offline shows the last read (with its date), only this
  // athlete's, only up to a week old, and nothing after sign-out.
  func testLastReadIsKeptOnDeviceForThisAthlete() throws {
    let file = tempCache()
    let body = Data(#"{"read":{"voice":"Body is settled."},"cards":[]}"#.utf8)
    let saved = Date(timeIntervalSince1970: 1_793_000_000)
    ReadCache.save(body, day: "2026-10-31", athleteId: "a1", at: saved, to: file)

    let back = try XCTUnwrap(ReadCache.load(athleteId: "a1", now: saved.addingTimeInterval(3600), from: file))
    XCTAssertEqual(back.day, "2026-10-31")
    XCTAssertEqual(back.body, body)
    XCTAssertNotNil(back.response, "the cached body decodes like a live reply")
    XCTAssertNil(ReadCache.load(athleteId: "a2", now: saved, from: file), "another athlete never sees it")
    XCTAssertNil(ReadCache.load(athleteId: "a1", now: saved.addingTimeInterval(8 * 86_400), from: file), "older than a week")

    let values = try file.resourceValues(forKeys: [.isExcludedFromBackupKey])
    XCTAssertEqual(values.isExcludedFromBackup, true, "health-derived data stays on this phone")

    ReadCache.clear(at: file)
    XCTAssertNil(ReadCache.load(athleteId: "a1", now: saved, from: file))
  }

  // When the connection comes back, a screen that failed, or still shows an
  // older day's read, loads again on its own.
  func testReconnectReloadsWhatFailed() {
    XCTAssertTrue(NetworkStatus.didComeBack(wasOnline: false, isOnline: true))
    XCTAssertFalse(NetworkStatus.didComeBack(wasOnline: true, isOnline: true))
    XCTAssertFalse(NetworkStatus.didComeBack(wasOnline: true, isOnline: false))

    XCTAssertTrue(ReadRetry.onReconnect(hasError: true, loadedDay: "2026-11-01", today: "2026-11-01", isLoading: false))
    XCTAssertTrue(ReadRetry.onReconnect(hasError: false, loadedDay: "2026-10-31", today: "2026-11-01", isLoading: false))
    XCTAssertFalse(ReadRetry.onReconnect(hasError: false, loadedDay: "2026-11-01", today: "2026-11-01", isLoading: false))
    XCTAssertFalse(ReadRetry.onReconnect(hasError: true, loadedDay: nil, today: "2026-11-01", isLoading: true))

    XCTAssertTrue(PlanSheet.reloadsOnReconnect(loadFailed: true, changesFailed: false))
    XCTAssertTrue(PlanSheet.reloadsOnReconnect(loadFailed: false, changesFailed: true))
    XCTAssertFalse(PlanSheet.reloadsOnReconnect(loadFailed: false, changesFailed: false))
  }

  func testOfflineCopyIsCalm() {
    let lines = NetworkText.every.flatMap(\.all) + [ReadDate.heading(loadedDay: "2026-10-31", today: "2026-11-01")]
    for line in lines {
      XCTAssertFalse(line.contains("!"), line)
      XCTAssertFalse(line.contains("\u{2014}"), line)
      XCTAssertFalse(line.unicodeScalars.contains { $0.properties.isEmojiPresentation }, line)
    }
  }
}
