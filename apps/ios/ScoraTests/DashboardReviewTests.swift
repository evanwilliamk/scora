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

  // This Week: a cancelled pull is quiet, a failure uses This Week's own words
  // (not Today's Read's), and an older reply landing late is dropped.
  func testWeeklyFetchUsesItsOwnLinesAndIgnoresCancellation() async {
    let cancelled = await ReadFetch.run(lines: NetworkText.weekly) { throw URLError(.cancelled) }
    XCTAssertEqual(cancelled, .cancelled)
    XCTAssertNil(cancelled.errorLine)
    let offline = await ReadFetch.run(lines: NetworkText.weekly) { throw URLError(.notConnectedToInternet) }
    XCTAssertEqual(offline, .failed(NetworkText.weekly.offline))
    let url = URL(string: "https://example.invalid/api/weekly")!
    let down = await ReadFetch.run(lines: NetworkText.weekly) {
      (Data(#"{"error":"LLM failed"}"#.utf8), HTTPURLResponse(url: url, statusCode: 500, httpVersion: nil, headerFields: nil)!)
    }
    XCTAssertEqual(down, .failed(NetworkText.weekly.other))

    var gate = ReadLoadGate()
    let first = gate.begin(), second = gate.begin()
    XCTAssertTrue(gate.accept(second))
    XCTAssertFalse(gate.accept(first), "the older weekly reply does not overwrite the newer one")
    XCTAssertFalse(gate.isLatest(first), "nor does its error line show")
  }

  // Work that outlives a sign-out changes nothing for whoever is signed in next.
  func testLateRepliesAfterSignOutAreDropped() {
    XCTAssertTrue(TokenManager.answerApplies(askedFor: "42", signedIn: "42"))
    XCTAssertFalse(TokenManager.answerApplies(askedFor: "42", signedIn: ""), "signed out meanwhile")
    XCTAssertFalse(TokenManager.answerApplies(askedFor: "42", signedIn: "77"), "another athlete signed in")
    XCTAssertFalse(TokenManager.answerApplies(askedFor: "", signedIn: ""))
    XCTAssertTrue(TimeZoneSync.keepsRecord(sentFor: "42", signedIn: "42"))
    XCTAssertFalse(TimeZoneSync.keepsRecord(sentFor: "42", signedIn: nil))
    XCTAssertFalse(TimeZoneSync.keepsRecord(sentFor: "42", signedIn: "77"))
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

  // Week So Far on an earlier day's read could be last week's bars under no
  // label, so it is shown only on the day's own read.
  func testOlderReadHidesWeekSoFar() throws {
    let week = try JSONDecoder().decode(WeekSoFar.self, from: Data(#"{"days":[{"date":"2026-10-26","weekday":"Mon","run_min":40}],"line":"1 run, 40 min since Monday."}"#.utf8))
    XCTAssertEqual(ReadDate.weekSoFar(week, loadedDay: "2026-11-01", today: "2026-11-01")?.line, week.line)
    XCTAssertEqual(ReadDate.weekSoFar(week, loadedDay: nil, today: "2026-11-02")?.line, week.line)
    XCTAssertNil(ReadDate.weekSoFar(week, loadedDay: "2026-11-01", today: "2026-11-02"), "Sunday's read seen on Monday")
    XCTAssertNil(ReadDate.weekSoFar(nil, loadedDay: "2026-11-02", today: "2026-11-02"))
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

  // A read asked for at 23:59 that lands after midnight: the midnight
  // handler skipped its reload (a load was in flight), so the landing one
  // asks for today's. Otherwise it stays up headed with yesterday's date,
  // its Today line, plan card and Week So Far hidden, until a pull.
  func testReadLandingAfterMidnightAsksForToday() {
    XCTAssertTrue(ReadRetry.afterLoad(askedFor: "2026-11-01", today: "2026-11-02", isLatest: true))
    XCTAssertFalse(ReadRetry.afterLoad(askedFor: "2026-11-02", today: "2026-11-02", isLatest: true))
    // A newer load is already on its way for today.
    XCTAssertFalse(ReadRetry.afterLoad(askedFor: "2026-11-01", today: "2026-11-02", isLatest: false))
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

// Settings (Q40 A): what it says about connections comes from the read and
// cards, and a Strava reconnect never swaps the athlete.
final class SettingsLogicTests: XCTestCase {
  func testStravaStatusOnlyClaimsWhatTheReadShowed() {
    XCTAssertEqual(StravaStatus.of(hasRead: true, error: nil), .connected)
    XCTAssertEqual(StravaStatus.of(hasRead: false, error: nil), .unknown)
    XCTAssertEqual(StravaStatus.of(hasRead: false, error: "Strava needs to be connected again."), .needsReconnect)
    XCTAssertEqual(StravaStatus.of(hasRead: true, error: "Strava not connected or refresh failed. Please reconnect Strava."), .needsReconnect)
    XCTAssertEqual(StravaStatus.of(hasRead: true, error: "Strava is not answering right now."), .unknown, "an outage is no sign the link is broken")
    XCTAssertEqual(StravaStatus.of(hasRead: false, error: "You appear to be offline."), .unknown)
    XCTAssertEqual(StravaStatus.of(hasRead: true, error: "Oura needs to be connected again."), .unknown)
  }

  func testReadRepliesCarryTheOuraConnection() throws {
    let base = #"{"read":{"voice":"x"},"cards":[]"#
    func decode(_ tail: String) throws -> ReadResponse {
      try JSONDecoder().decode(ReadResponse.self, from: Data((base + tail).utf8))
    }
    XCTAssertEqual(try decode(#","connections":{"strava":true,"oura":false,"healthKit":true}}"#).connections?.oura, false)
    XCTAssertEqual(try decode(#","connections":{"strava":true,"oura":true}}"#).connections?.oura, true)
    XCTAssertNil(try decode("}").connections, "a cached or older reply has no field")
  }

  func testOuraStatusFromTheRead() {
    XCTAssertEqual(OuraStatus.of(connected: nil), .unknown)
    XCTAssertEqual(OuraStatus.of(connected: true), .connected)
    XCTAssertEqual(OuraStatus.of(connected: false), .notConnected)
    XCTAssertEqual(OuraStatus.notConnected.buttonLabel, "Connect Oura")
    XCTAssertEqual(OuraStatus.connected.buttonLabel, "Reconnect Oura")
    XCTAssertEqual(OuraStatus.unknown.buttonLabel, "Reconnect Oura")
  }

  func testStravaReconnectOutcome() {
    XCTAssertEqual(StravaReconnect.outcome(incoming: "1", pendingFor: nil), .signIn)
    XCTAssertEqual(StravaReconnect.outcome(incoming: "1", pendingFor: "1"), .reconnected)
    XCTAssertEqual(StravaReconnect.outcome(incoming: "2", pendingFor: "1"), .otherAccount)
  }

  func testSignOutForgetsAStartedReconnect() {
    // With no athlete id, unregister sends nothing and no real API is called.
    UserDefaults.standard.removeObject(forKey: "scora.athleteId")
    stub(200)
    StravaReconnect.begin(athleteId: "1")
    addTeardownBlock { StravaReconnect.clear() }
    TokenManager().logout()
    XCTAssertNil(StravaReconnect.pendingFor)
  }

  func testShownMinutePrefersThisAthletesWaitingChoice() {
    let waiting = PendingOnboarding(athleteId: "1", timezone: "UTC", deliveryMinute: 420)
    XCTAssertEqual(SettingsPrefs.shownMinute(remote: 360, pending: waiting, athleteId: "1"), 420)
    XCTAssertEqual(SettingsPrefs.shownMinute(remote: 360, pending: waiting, athleteId: "2"), 360)
    XCTAssertEqual(SettingsPrefs.shownMinute(remote: 360, pending: nil, athleteId: "1"), 360)
  }

  // MARK: Requests, through the stubbed transport

  private var savedTransport: OnboardingSync.Transport!
  private var savedAthlete: String?
  private var savedZone: Any?
  private var sent: [URLRequest] = []

  override func setUp() {
    super.setUp()
    savedTransport = OnboardingSync.transport
    savedAthlete = UserDefaults.standard.string(forKey: "scora.athleteId")
    OnboardingSync.pending = nil
    TimeZoneSync.forget()
    sent = []
  }

  override func tearDown() {
    OnboardingSync.transport = savedTransport
    UserDefaults.standard.set(savedAthlete, forKey: "scora.athleteId")
    OnboardingSync.pending = nil
    TimeZoneSync.forget()
    super.tearDown()
  }

  private func stub(_ status: Int?, body: String = "{}") {
    OnboardingSync.transport = { [weak self] req in
      self?.sent.append(req)
      guard let status else { return nil }
      return (status, Data(body.utf8))
    }
  }

  func testLoadReadsTheSavedMinute() async {
    stub(200, body: #"{"timezone":"UTC","deliveryMinute":405,"onboarded":true}"#)
    let minute = await SettingsPrefs.load(athleteId: "1")
    XCTAssertEqual(minute, 405)
    XCTAssertEqual(sent.first?.httpMethod, "GET")
    XCTAssertTrue(sent.first?.url?.query?.contains("athleteId=1") ?? false)
  }

  func testLoadFailureIsNilNotADefault() async {
    stub(nil)
    var minute = await SettingsPrefs.load(athleteId: "1")
    XCTAssertNil(minute)
    stub(500)
    minute = await SettingsPrefs.load(athleteId: "1")
    XCTAssertNil(minute)
    stub(200, body: #"{"timezone":"UTC"}"#)
    minute = await SettingsPrefs.load(athleteId: "1")
    XCTAssertNil(minute)
  }

  func testSaveSendsMinuteAndZoneAndReplacesAWaitingChoice() async throws {
    UserDefaults.standard.set("1", forKey: "scora.athleteId")
    OnboardingSync.keep(PendingOnboarding(athleteId: "1", timezone: "UTC", deliveryMinute: 420))
    stub(200)
    let ok = await SettingsPrefs.save(athleteId: "1", minute: 390, zone: "Asia/Tokyo")
    XCTAssertTrue(ok)
    let req = try XCTUnwrap(sent.first)
    XCTAssertEqual(req.httpMethod, "PUT")
    let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(req.httpBody)) as? [String: Any])
    XCTAssertEqual(body["athleteId"] as? String, "1")
    XCTAssertEqual(body["deliveryMinute"] as? Int, 390)
    XCTAssertEqual(body["timezone"] as? String, "Asia/Tokyo")
    XCTAssertEqual(body["onboarded"] as? Bool, true)
    XCTAssertNil(OnboardingSync.pending, "the old choice must not overwrite this one on the next launch")
    XCTAssertFalse(TimeZoneSync.needsSync(current: "Asia/Tokyo"))
  }

  func testFailedSaveKeepsAWaitingChoiceAndRecordsNoZone() async {
    UserDefaults.standard.set("1", forKey: "scora.athleteId")
    let waiting = PendingOnboarding(athleteId: "1", timezone: "UTC", deliveryMinute: 420)
    OnboardingSync.keep(waiting)
    stub(500)
    var ok = await SettingsPrefs.save(athleteId: "1", minute: 390, zone: "Asia/Tokyo")
    XCTAssertFalse(ok)
    stub(nil)
    ok = await SettingsPrefs.save(athleteId: "1", minute: 390, zone: "Asia/Tokyo")
    XCTAssertFalse(ok)
    XCTAssertEqual(OnboardingSync.pending, waiting)
    XCTAssertTrue(TimeZoneSync.needsSync(current: "Asia/Tokyo"))
  }

  func testSaveLandingAfterSignOutRecordsNoZone() async {
    UserDefaults.standard.removeObject(forKey: "scora.athleteId")
    stub(200)
    let ok = await SettingsPrefs.save(athleteId: "1", minute: 390, zone: "Asia/Tokyo")
    XCTAssertTrue(ok)
    XCTAssertTrue(TimeZoneSync.needsSync(current: "Asia/Tokyo"))
  }

  // MARK: Review of claude/ios-settings

  func testDroppedAccountStaysDroppedWhenTheBrowserButtonSendsItAgain() {
    StravaReconnect.begin(athleteId: "1")
    addTeardownBlock { StravaReconnect.clear() }
    XCTAssertEqual(StravaReconnect.resolve(incoming: "2"), .otherAccount)
    XCTAssertEqual(StravaReconnect.resolve(incoming: "2"), .otherAccount, "Open SCORA on the page sends the same link")
    XCTAssertEqual(StravaReconnect.resolve(incoming: "1"), .reconnected, "the right account still gets through")
    XCTAssertNil(StravaReconnect.pendingFor)
    XCTAssertEqual(StravaReconnect.resolve(incoming: "1"), .signIn, "a second tap on the right account's link is harmless")
  }

  func testDeclinedReconnectClearsTheFlagAndSaysSo() {
    addTeardownBlock { StravaReconnect.clear() }
    XCTAssertNil(StravaReconnect.failure(), "no reconnect started: the sign-in screen says nothing new")
    StravaReconnect.begin(athleteId: "1")
    XCTAssertEqual(StravaReconnect.failure()?.message, StravaReconnect.notReconnectedLine)
    XCTAssertEqual(StravaReconnect.failure()?.connected, nil)
    XCTAssertNil(StravaReconnect.pendingFor)
  }

  func testBannerWaitsForADashboardStillAppearing() {
    addTeardownBlock { OuraLinkResult.pending = nil }
    let line = OuraLinkResult(connected: true, message: StravaReconnect.connectedLine)
    OuraLinkResult.deliver(line, dashboardIsRoot: true)
    XCTAssertEqual(OuraLinkResult.take(), line)
    XCTAssertNil(OuraLinkResult.take(), "shown once")
    OuraLinkResult.deliver(line, dashboardIsRoot: false)
    XCTAssertNil(OuraLinkResult.take(), "onboarding has no banner, and none shows later")
  }

  // The exact sentences of apps/api/src/vendor-error.ts, through the app's own filter.
  func testServerSentencesReachTheStatusAsTheServerWroteThem() {
    func status(_ sentence: String) -> StravaStatus {
      let body = try! JSONSerialization.data(withJSONObject: ["error": sentence])
      let shown = APIErrorText.message(from: body, fallback: ReadFetch.failureLine)
      XCTAssertEqual(shown, sentence, "the filter keeps it")
      return StravaStatus.connected.after(failure: shown)
    }
    XCTAssertEqual(status("Strava needs to be connected again."), .needsReconnect)
    XCTAssertEqual(status("Strava not connected or refresh failed. Please reconnect Strava."), .needsReconnect)
    XCTAssertEqual(status("Strava is not answering right now."), .unknown)
    XCTAssertEqual(StravaStatus.connected.after(failure: ReadFetch.failureLine), .unknown)
    for line in NetworkText.read.all {
      XCTAssertEqual(StravaStatus.needsReconnect.after(failure: line), .unknown)
    }
  }

  func testACancelledLoadLeavesTheLastStravaAnswer() {
    XCTAssertEqual(StravaStatus.connected.after(failure: nil), .connected)
    XCTAssertEqual(StravaStatus.needsReconnect.after(failure: nil), .needsReconnect)
    XCTAssertEqual(StravaStatus.unknown.after(failure: nil), .unknown, "a kept read on screen proves nothing")
  }

  func testOuraFailureBannersPointToSettings() throws {
    // Reconnect from Settings can fail with a ring already linked, when the
    // Sleep card has no connect prompt to go back to.
    for link in ["scora://oura/failed?reason=cancelled", "scora://oura/failed"] {
      let message = try XCTUnwrap(OuraLinkResult(url: URL(string: link)!)).message
      XCTAssertTrue(message.contains("Settings"), message)
      XCTAssertFalse(message.contains("Sleep card"), message)
      XCTAssertTrue(message.contains("Nothing changed"), message)
    }
  }

  // Holds the first request until released, recording each request's body order.
  private func holdFirstRequest() -> AsyncStream<Void>.Continuation {
    var release: AsyncStream<Void>.Continuation!
    let gate = AsyncStream<Void> { release = $0 }
    var first = true
    OnboardingSync.transport = { [weak self] req in
      self?.sent.append(req)
      if first {
        first = false
        for await _ in gate { break }
      }
      return (200, Data(#"{"deliveryMinute":390}"#.utf8))
    }
    return release
  }

  private func sentMinutes() -> [Int?] {
    sent.map { req in
      req.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["deliveryMinute"] as? Int
    }
  }

  private func waitForRequests(_ count: Int) async {
    for _ in 0..<200 where sent.count < count { try? await Task.sleep(nanoseconds: 10_000_000) }
  }

  func testSettingsSaveWaitsForAFlushOnItsWaySoTheNewerTimeLandsLast() async {
    UserDefaults.standard.set("1", forKey: "scora.athleteId")
    OnboardingSync.keep(PendingOnboarding(athleteId: "1", timezone: "UTC", deliveryMinute: 420))
    let release = holdFirstRequest()
    async let flushed = OnboardingSync.flush(athleteId: "1")
    await waitForRequests(1)
    async let saved = SettingsPrefs.save(athleteId: "1", minute: 390, zone: "UTC")
    try? await Task.sleep(nanoseconds: 100_000_000)
    XCTAssertEqual(sent.count, 1, "the save does not overtake the flush")
    release.yield()
    let results = await (flushed, saved)
    XCTAssertTrue(results.0)
    XCTAssertTrue(results.1)
    XCTAssertEqual(sentMinutes(), [420, 390])
    XCTAssertNil(OnboardingSync.pending)
  }

  func testAFlushStartedDuringASaveFindsNothingLeftToSend() async {
    UserDefaults.standard.set("1", forKey: "scora.athleteId")
    OnboardingSync.keep(PendingOnboarding(athleteId: "1", timezone: "UTC", deliveryMinute: 420))
    let release = holdFirstRequest()
    async let saved = SettingsPrefs.save(athleteId: "1", minute: 390, zone: "UTC")
    await waitForRequests(1)
    async let flushed = OnboardingSync.flush(athleteId: "1") // a same-account reconnect does this
    try? await Task.sleep(nanoseconds: 100_000_000)
    release.yield()
    _ = await (saved, flushed)
    XCTAssertEqual(sentMinutes(), [390], "the old choice is never sent after the newer one")
  }

  func testLoadWaitsForASaveOnItsWay() async {
    UserDefaults.standard.set("1", forKey: "scora.athleteId")
    let release = holdFirstRequest()
    async let saved = SettingsPrefs.save(athleteId: "1", minute: 390, zone: "UTC")
    await waitForRequests(1)
    async let loaded = SettingsPrefs.load(athleteId: "1") // Settings reopened at once
    try? await Task.sleep(nanoseconds: 100_000_000)
    XCTAssertEqual(sent.count, 1, "reads only after the save has landed")
    release.yield()
    let results = await (saved, loaded)
    XCTAssertTrue(results.0)
    XCTAssertEqual(results.1, 390)
    XCTAssertEqual(sent.map(\.httpMethod), ["PUT", "GET"])
  }
}
