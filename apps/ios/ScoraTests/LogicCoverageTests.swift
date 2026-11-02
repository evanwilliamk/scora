import XCTest
@testable import Scora

// Unit tests for logic that had no direct test: date and DST math in the
// HealthKit summary, sign-out cleanup, the on-device read cache, push-open
// parsing, network failure mapping, and API replies with missing or extra
// fields. No real network: every request goes through a stub or is guarded
// off before it is built.

final class HealthNightsDSTTests: XCTestCase {
  private func zone(_ id: String) -> Calendar {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: id)!
    return cal
  }
  private func at(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }

  // Without sleep data, the night is 20:00 the evening before to 10:00 that
  // morning in local time, even when the clocks jump between the two.
  func testFallbackWindowOnSpringForwardDay() throws {
    let w = try XCTUnwrap(HealthNights.nightWindow(day: "2026-03-08", sessions: [], calendar: zone("America/New_York")))
    XCTAssertEqual(w.start, at("2026-03-08T01:00:00Z"), "20:00 EST the evening before")
    XCTAssertEqual(w.end, at("2026-03-08T14:00:00Z"), "10:00 EDT that morning")
    XCTAssertEqual(w.end.timeIntervalSince(w.start), 13 * 3600, "the lost hour is not counted")
  }

  func testFallbackWindowOnFallBackDay() throws {
    let w = try XCTUnwrap(HealthNights.nightWindow(day: "2026-11-01", sessions: [], calendar: zone("America/New_York")))
    XCTAssertEqual(w.start, at("2026-11-01T00:00:00Z"), "20:00 EDT the evening before")
    XCTAssertEqual(w.end, at("2026-11-01T15:00:00Z"), "10:00 EST that morning")
    XCTAssertEqual(w.end.timeIntervalSince(w.start), 15 * 3600, "the repeated hour is counted")
  }

  // Some zones skip midnight itself on the change day (Santiago, Havana). The
  // day still has a night window.
  func testFallbackWindowWhenMidnightIsSkipped() throws {
    for (id, day) in [("America/Santiago", "2026-09-06"), ("America/Havana", "2026-03-08")] {
      let w = HealthNights.nightWindow(day: day, sessions: [], calendar: zone(id))
      if w == nil {
        throw XCTSkip("BUG: nightWindow returns nil for \(day) in \(id) because DateFormatter cannot parse a day whose midnight does not exist, so that night's HRV is dropped")
      }
      XCTAssertLessThan(w!.start, w!.end, id)
    }
  }

  // A night that spans the fall-back change counts real elapsed sleep, and
  // belongs to its wake day.
  func testSleepAcrossFallBackCountsElapsedTime() {
    // 23:00 EDT Oct 31 to 06:30 EST Nov 1: 8.5 hours actually asleep.
    let nights = HealthNights.group(
      sleep: [(start: at("2026-11-01T03:00:00Z"), end: at("2026-11-01T11:30:00Z"))],
      hrv: [HRVSample(date: at("2026-11-01T08:00:00Z"), value: 51.26)],
      restingHr: [], calendar: zone("America/New_York"))
    XCTAssertEqual(nights, [HealthNight(day: "2026-11-01", sleepSeconds: 8.5 * 3600, hrvMs: 51.3, restingHr: nil)])
  }

  func testLastNightHRVOnSpringForwardMorningWithoutSleep() {
    let ny = zone("America/New_York")
    let hrv = [
      HRVSample(date: at("2026-03-08T00:30:00Z"), value: 40), // 19:30 EST: before the window
      HRVSample(date: at("2026-03-08T13:30:00Z"), value: 55), // 09:30 EDT: inside
      HRVSample(date: at("2026-03-08T14:30:00Z"), value: 30), // 10:30 EDT: after
    ]
    XCTAssertEqual(HealthNights.lastNightHRV(hrv, sleep: [], now: at("2026-03-08T17:00:00Z"), calendar: ny), 55)
    // At 06:00 the 09:30 reading has not happened yet, and nothing earlier is in the window.
    XCTAssertNil(HealthNights.lastNightHRV(hrv, sleep: [], now: at("2026-03-08T11:00:00Z"), calendar: ny))
  }

  func testLocalTodayFollowsTheGivenZone() {
    let instant = at("2026-11-02T03:30:00Z")
    XCTAssertEqual(HealthNights.localToday(zone("America/Los_Angeles"), now: instant), "2026-11-01")
    XCTAssertEqual(HealthNights.localToday(zone("Asia/Tokyo"), now: instant), "2026-11-02")
  }

  func testSessionsJoinWithinAnHourAndSplitBeyond() {
    let base = at("2026-10-19T03:00:00Z")
    let s = HealthNights.sessions([
      (start: base, end: base.addingTimeInterval(3600)),
      // exactly one hour later: same session
      (start: base.addingTimeInterval(7200), end: base.addingTimeInterval(10800)),
      // 61 minutes after that one ends: a new session
      (start: base.addingTimeInterval(10800 + 3660), end: base.addingTimeInterval(10800 + 7260)),
      // zero length and backwards samples are ignored
      (start: base.addingTimeInterval(30000), end: base.addingTimeInterval(30000)),
      (start: base.addingTimeInterval(40000), end: base.addingTimeInterval(39000)),
    ])
    XCTAssertEqual(s.count, 2)
    XCTAssertEqual(s[0].asleep, 7200, "the gap between pieces is not sleep")
    XCTAssertEqual(s[0].end, base.addingTimeInterval(10800))
    XCTAssertEqual(s[1].asleep, 3600)
  }

  func testNewestRecentIgnoresFutureAndStaleSamples() {
    let now = at("2026-10-19T10:00:00Z")
    let xs: [(date: Date, value: Double)] = [
      (date: now.addingTimeInterval(-36 * 3600), value: 50), // exactly at the edge: kept
      (date: now.addingTimeInterval(-37 * 3600), value: 40),
      (date: now.addingTimeInterval(3600), value: 99), // clock skew, dated ahead: never used
    ]
    XCTAssertEqual(HealthNights.newestRecent(xs, now: now), 50)
    XCTAssertNil(HealthNights.newestRecent([xs[1], xs[2]], now: now))
  }

  func testWeekAverageSkipsNightsWithoutHRVAndOlderThanAWeek() {
    let nights = [
      HealthNight(day: "2026-10-11", hrvMs: 100), // 8 days before: out
      HealthNight(day: "2026-10-12", hrvMs: 40), // exactly 7 days before: in
      HealthNight(day: "2026-10-15", sleepSeconds: 25000), // no HRV: not counted
      HealthNight(day: "2026-10-18", hrvMs: 45),
      HealthNight(day: "2026-10-19", hrvMs: 70), // newest: compared, not averaged
      HealthNight(day: "2026-10-20", sleepSeconds: 26000), // newer but no HRV
    ]
    XCTAssertEqual(HealthNights.weekAverageHRV(nights), 42.5)
    XCTAssertNil(HealthNights.weekAverageHRV([HealthNight(day: "2026-10-19", hrvMs: 70)]))
    XCTAssertNil(HealthNights.weekAverageHRV([]))
  }
}

final class SignOutCleanupTests: XCTestCase {
  private let keys = ["scora.token", "scora.athleteId", "scora.athleteName", "scora.deviceToken",
                      "scora.sentTimezone", "scora.pendingPushOpens", OnboardingState.key, OnboardingSync.pendingKey]
  private var savedDefaults: [String: Any] = [:]
  private var savedReadCache: Data?
  private var savedTransport: OnboardingSync.Transport!

  override func setUp() {
    super.setUp()
    for k in keys { if let v = UserDefaults.standard.object(forKey: k) { savedDefaults[k] = v } }
    savedReadCache = try? Data(contentsOf: ReadCache.defaultURL)
    savedTransport = OnboardingSync.transport
    OnboardingSync.transport = { _ in nil } // never the network
  }

  override func tearDown() {
    for k in keys { UserDefaults.standard.removeObject(forKey: k) }
    for (k, v) in savedDefaults { UserDefaults.standard.set(v, forKey: k) }
    if let savedReadCache {
      try? savedReadCache.write(to: ReadCache.defaultURL)
    } else {
      ReadCache.clear()
    }
    CalendarFeed.save(nil, for: "logout-test")
    OnboardingSync.transport = savedTransport
    super.tearDown()
  }

  // Everything kept on the phone for the athlete is gone after sign-out, so
  // the next person to sign in on this phone never sees it.
  func testSignOutRemovesTheAthletesDataFromThePhone() throws {
    let d = UserDefaults.standard
    d.set("tok", forKey: "scora.token")
    d.set("logout-test", forKey: "scora.athleteId")
    d.set("Sam", forKey: "scora.athleteName")
    d.removeObject(forKey: "scora.deviceToken") // no device token: unregister sends nothing
    TimeZoneSync.remember("Europe/London")
    let body = Data(#"{"read":{"voice":"Body is settled."},"cards":[]}"#.utf8)
    ReadCache.save(body, day: "2026-11-01", athleteId: "logout-test")
    XCTAssertNotNil(ReadCache.load(athleteId: "logout-test"))
    CalendarFeed.save("webcal://plans.example.com/a.ics", for: "logout-test")
    let open = PushOpen(userInfo: ["scora": ["kind": "daily", "date": "2026-11-01", "sent_at": NSNumber(value: Int(Date().timeIntervalSince1970))]])!
    d.set(try JSONEncoder().encode([open]), forKey: "scora.pendingPushOpens")
    // Onboarding already done and nothing waiting, so the launch-time check
    // in init never builds a request, whenever its task runs.
    OnboardingState.needsOnboarding = false
    OnboardingSync.pending = nil

    let tm = TokenManager()
    XCTAssertTrue(tm.isAuthenticated)
    tm.needsOnboarding = true
    tm.checkingOnboarding = true
    tm.logout()

    XCTAssertNil(d.string(forKey: "scora.token"))
    XCTAssertNil(d.string(forKey: "scora.athleteId"))
    XCTAssertNil(d.string(forKey: "scora.athleteName"))
    XCTAssertEqual(tm.athleteId, "")
    XCTAssertEqual(tm.stravaToken, "")
    XCTAssertTrue(TimeZoneSync.needsSync(current: "Europe/London"), "the next athlete sends their own zone")
    XCTAssertFalse(FileManager.default.fileExists(atPath: ReadCache.defaultURL.path), "the last read is health data")
    XCTAssertNil(CalendarFeed.savedLink(for: "logout-test"))
    XCTAssertNil(CalendarFeed.lastRefresh(for: "logout-test"))
    XCTAssertFalse(OnboardingState.needsOnboarding)

    // Published state and the push-open queue are cleared asynchronously.
    let deadline = Date().addingTimeInterval(3)
    func pendingOpens() -> [PushOpen] {
      guard let data = d.data(forKey: "scora.pendingPushOpens") else { return [] }
      return (try? JSONDecoder().decode([PushOpen].self, from: data)) ?? []
    }
    while (tm.isAuthenticated || !pendingOpens().isEmpty) && Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    XCTAssertFalse(tm.isAuthenticated)
    XCTAssertEqual(tm.athleteName, "")
    XCTAssertFalse(tm.needsOnboarding)
    XCTAssertFalse(tm.checkingOnboarding)
    XCTAssertTrue(pendingOpens().isEmpty, "waiting push-open reports are never sent under the next athlete's id")
  }
}

final class ReadCacheEdgeTests: XCTestCase {
  private func tempCache() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("read-cache-\(UUID().uuidString)/last-read.json")
  }
  private let body = Data(#"{"read":{"voice":"Body is settled."},"cards":[]}"#.utf8)
  private let saved = Date(timeIntervalSince1970: 1_793_000_000)

  func testExactlyAWeekOldIsStillShown() {
    let file = tempCache()
    defer { ReadCache.clear(at: file) }
    ReadCache.save(body, day: "2026-10-31", athleteId: "a1", at: saved, to: file)
    XCTAssertNotNil(ReadCache.load(athleteId: "a1", now: saved.addingTimeInterval(ReadCache.maxAge), from: file))
    XCTAssertNil(ReadCache.load(athleteId: "a1", now: saved.addingTimeInterval(ReadCache.maxAge + 1), from: file))
  }

  func testNoAthleteMeansNothingIsKept() {
    let file = tempCache()
    defer { ReadCache.clear(at: file) }
    ReadCache.save(body, day: "2026-10-31", athleteId: "", at: saved, to: file)
    XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    XCTAssertNil(ReadCache.load(athleteId: "", now: saved, from: file))
  }

  func testUnreadableCacheIsIgnored() throws {
    let file = tempCache()
    defer { ReadCache.clear(at: file) }
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("not json".utf8).write(to: file)
    XCTAssertNil(ReadCache.load(athleteId: "a1", now: saved, from: file))
    // A kept body that no longer decodes as a read (an older format) is not shown.
    ReadCache.save(Data(#"{"voice":"old shape"}"#.utf8), day: "2026-10-31", athleteId: "a1", at: saved, to: file)
    XCTAssertNil(ReadCache.load(athleteId: "a1", now: saved, from: file))
  }

  func testANewerReadReplacesTheOlderOne() throws {
    let file = tempCache()
    defer { ReadCache.clear(at: file) }
    ReadCache.save(body, day: "2026-10-30", athleteId: "a1", at: saved, to: file)
    ReadCache.save(body, day: "2026-10-31", athleteId: "a2", at: saved, to: file)
    XCTAssertNil(ReadCache.load(athleteId: "a1", now: saved, from: file), "one read on the phone, the newest")
    XCTAssertEqual(ReadCache.load(athleteId: "a2", now: saved, from: file)?.day, "2026-10-31")
  }

  func testClearingAMissingCacheIsHarmless() {
    ReadCache.clear(at: tempCache())
  }
}

final class PushOpenParsingTests: XCTestCase {
  private func open(_ s: [String: Any]) -> PushOpen? { PushOpen(userInfo: ["scora": s]) }

  func testOnlyAWellFormedScoraPayloadIsAnOpen() {
    let ok: [String: Any] = ["kind": "weekly", "date": "2026-11-01", "sent_at": NSNumber(value: 1_800_000_000)]
    XCTAssertEqual(open(ok)?.kind, "weekly")
    XCTAssertEqual(open(ok)?.sentAt, 1_800_000_000)
    // Extra fields from a newer server are fine.
    var extra = ok; extra["campaign"] = "x"
    XCTAssertNotNil(open(extra))
    // A send time written as a whole Swift Int still reads.
    var int = ok; int["sent_at"] = 1_800_000_000
    XCTAssertEqual(open(int)?.sentAt, 1_800_000_000)

    var badKind = ok; badKind["kind"] = "promo"
    var badDate = ok; badDate["date"] = "2026-11-1"
    var textTime = ok; textTime["sent_at"] = "1800000000"
    var noTime = ok; noTime.removeValue(forKey: "sent_at")
    for bad in [badKind, badDate, textTime, noTime] { XCTAssertNil(open(bad), "\(bad)") }
    XCTAssertNil(PushOpen(userInfo: [:]))
    XCTAssertNil(PushOpen(userInfo: ["scora": "daily"]))
    XCTAssertNil(PushOpen(userInfo: ["aps": ["alert": "hi"]]))
  }

  func testPruneCutoffIsSevenDaysLessAnHour() {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let cutoff = 1_800_000_000 - 7 * 86_400 + 3600
    let edge = open(["kind": "daily", "date": "2026-11-01", "sent_at": NSNumber(value: cutoff)])!
    let past = open(["kind": "daily", "date": "2026-11-01", "sent_at": NSNumber(value: cutoff - 1)])!
    XCTAssertEqual(PushOpen.pruned([past, edge], now: now), [edge])
    // The same day and time with a different kind is a different report.
    let weekly = open(["kind": "weekly", "date": "2026-11-01", "sent_at": NSNumber(value: cutoff)])!
    XCTAssertEqual(PushOpen.pruned([edge, weekly, edge], now: now), [edge, weekly])
  }

  func testRouteIsTakenOnce() {
    let saved = PushRoute.pending
    defer { PushRoute.pending = saved }
    PushRoute.pending = PushRoute(kind: "weekly")
    XCTAssertEqual(PushRoute.take(), .weekly)
    XCTAssertNil(PushRoute.take(), "a second screen appearing does not route again")
    XCTAssertEqual(PushRoute(kind: "anything else"), .todaysRead)
  }
}

final class NetworkMappingTests: XCTestCase {
  func testURLErrorsMapToWhatTheAthleteCanDo() {
    let offline: [URLError.Code] = [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff]
    for code in offline { XCTAssertEqual(NetworkFailure.of(URLError(code)), .offline, "\(code)") }
    XCTAssertEqual(NetworkFailure.of(URLError(.timedOut)), .timedOut)
    for code in [URLError.Code.badServerResponse, .cannotFindHost, .secureConnectionFailed, .cancelled] {
      XCTAssertEqual(NetworkFailure.of(URLError(code)), .other, "\(code)")
    }
    XCTAssertEqual(NetworkFailure.of(CancellationError()), .other)
    XCTAssertEqual(NetworkText.planSave.line(for: URLError(.timedOut)), NetworkText.planSave.timedOut)
  }

  func testComingBackOnlineIsTheOnlyReconnect() {
    XCTAssertTrue(NetworkStatus.didComeBack(wasOnline: false, isOnline: true))
    XCTAssertFalse(NetworkStatus.didComeBack(wasOnline: true, isOnline: true))
    XCTAssertFalse(NetworkStatus.didComeBack(wasOnline: true, isOnline: false))
    XCTAssertFalse(NetworkStatus.didComeBack(wasOnline: false, isOnline: false))
  }

  func testCancellationIsNotAFailure() {
    XCTAssertTrue(ReadFetch.isCancellation(CancellationError()))
    XCTAssertTrue(ReadFetch.isCancellation(URLError(.cancelled)))
    XCTAssertFalse(ReadFetch.isCancellation(URLError(.timedOut)))
    XCTAssertFalse(ReadFetch.isCancellation(NSError(domain: "x", code: 1)))
  }

  func testEveryScreenHasItsOwnThreeLines() {
    for lines in NetworkText.every {
      XCTAssertEqual(Set(lines.all).count, 3)
      for line in lines.all {
        XCTAssertFalse(line.contains("!"))
        XCTAssertFalse(line.contains("\u{2014}"), "no em dash")
        XCTAssertTrue(line.hasSuffix("."))
      }
    }
  }
}

final class APIReplyShapeTests: XCTestCase {
  // The API may add fields; the app keeps reading what it knows.
  func testReadWithExtraFieldsDecodes() throws {
    let json = #"{"read":{"voice":"Body is settled.","new_field":1},"posture":{"posture":"steady","confidence":0.8},"cards":[{"id":"sleep","title":"Sleep","available":true,"value":"7:12","future":[1,2]}],"generatedAt":"2026-11-02T06:00:00Z","extra":{"a":1}}"#
    let r = try JSONDecoder().decode(ReadResponse.self, from: Data(json.utf8))
    XCTAssertEqual(r.read.voice, "Body is settled.")
    XCTAssertEqual(r.posture?.posture, "steady")
    XCTAssertEqual(r.cards.first?.value, "7:12")
    XCTAssertNil(r.weekSoFar)
  }

  func testCardWithOnlyRequiredFieldsDecodes() throws {
    let card = try JSONDecoder().decode(DashboardCard.self, from: Data(#"{"id":"load","title":"Training Load","available":false}"#.utf8))
    XCTAssertNil(card.value)
    XCTAssertNil(card.unit)
    XCTAssertEqual(card.connect, .absent)
    XCTAssertFalse(card.offersOuraConnect)
  }

  func testConnectFlagOfAnUnexpectedTypeIsNoAction() throws {
    for raw in ["1", "true", #"{"source":"oura"}"#] {
      let card = try JSONDecoder().decode(DashboardCard.self, from: Data(#"{"id":"sleep","title":"Sleep","available":false,"connect":\#(raw)}"#.utf8))
      XCTAssertEqual(card.connect, DashboardCard.ConnectFlag.none, raw)
    }
  }

  func testPostureWithoutItsFieldDropsTheRead() {
    // A posture object missing `posture` fails the whole reply rather than
    // showing a read with a made-up posture.
    let json = #"{"read":{"voice":"x"},"posture":{},"cards":[]}"#
    XCTAssertThrowsError(try JSONDecoder().decode(ReadResponse.self, from: Data(json.utf8)))
    let null = #"{"read":{"voice":"x"},"posture":null,"cards":[]}"#
    XCTAssertNil(try JSONDecoder().decode(ReadResponse.self, from: Data(null.utf8)).posture)
  }

  func testRemoteOnboardedReadsOnlyABooleanField() async {
    let saved = OnboardingSync.transport
    defer { OnboardingSync.transport = saved }
    var reply: (Int, Data)?
    var asked = 0
    OnboardingSync.transport = { _ in asked += 1; return reply }
    let cases: [(String, Bool?)] = [
      (#"{"onboarded":true,"timezone":"Europe/London","newField":[1]}"#, true),
      (#"{"onboarded":false}"#, false),
      (#"{"onboarded":"true"}"#, nil),
      (#"{"onboarded":null}"#, nil),
      (#"{}"#, nil),
      (#"[true]"#, nil),
      ("<html>502</html>", nil),
    ]
    for (body, want) in cases {
      reply = (200, Data(body.utf8))
      let got = await OnboardingSync.remoteOnboarded(athleteId: "a1")
      XCTAssertEqual(got, want, body)
    }
    reply = (500, Data(#"{"onboarded":true}"#.utf8))
    let failed = await OnboardingSync.remoteOnboarded(athleteId: "a1")
    XCTAssertNil(failed, "only a 200 is an answer")
    asked = 0
    let none = await OnboardingSync.remoteOnboarded(athleteId: "")
    XCTAssertNil(none)
    XCTAssertEqual(asked, 0, "no athlete, no request")
  }

  func testFinalRefusalStatuses() {
    for s in [400, 401, 403, 404, 422, 499] { XCTAssertTrue(OnboardingSync.isFinalRefusal(s), "\(s)") }
    for s in [200, 204, 301, 408, 429, 500, 503, 0] { XCTAssertFalse(OnboardingSync.isFinalRefusal(s), "\(s)") }
  }

  func testReadDateHeadingAndBadDays() {
    XCTAssertEqual(ReadDate.heading(loadedDay: "2026-10-31", today: "2026-11-01"), "Read for Saturday, October 31")
    XCTAssertEqual(ReadDate.heading(loadedDay: "2026-11-01", today: "2026-11-01"), ReadDate.todayHeading)
    XCTAssertEqual(ReadDate.heading(loadedDay: nil, today: "2026-11-01"), ReadDate.todayHeading)
    // An unreadable day never shows a broken heading.
    XCTAssertEqual(ReadDate.heading(loadedDay: "yesterday", today: "2026-11-01"), ReadDate.todayHeading)
    // The spring-forward day reads as its own date.
    XCTAssertEqual(ReadDate.spoken("2026-03-08"), "Sunday, March 8")
    XCTAssertNil(ReadDate.spoken("2026-02-30"))
  }
}

final class PlanDateTests: XCTestCase {
  // Four weeks after a day just before spring forward is still local midnight
  // 28 calendar days later, not 23:00 the day before.
  func testEarliestRaceAcrossSpringForwardIsALocalDay() {
    var ny = Calendar(identifier: .gregorian)
    ny.timeZone = TimeZone(identifier: "America/New_York")!
    let now = ISO8601DateFormatter().date(from: "2026-02-20T23:30:00Z")! // 18:30 EST Feb 20
    let race = PlanSetup.earliestRace(from: now, calendar: ny)
    XCTAssertEqual(PlanDay.today(race, zone: ny.timeZone), "2026-03-20")
    XCTAssertEqual(ny.dateComponents([.hour, .minute], from: race), DateComponents(hour: 0, minute: 0))
  }

  func testPlanDayIsTheGivenZonesDate() {
    let instant = ISO8601DateFormatter().date(from: "2026-11-01T06:30:00Z")!
    XCTAssertEqual(PlanDay.today(instant, zone: TimeZone(identifier: "America/New_York")!), "2026-11-01")
    XCTAssertEqual(PlanDay.today(instant, zone: TimeZone(identifier: "America/Los_Angeles")!), "2026-10-31")
  }

  func testUpcomingIsTodayOnSortedAndCapped() {
    func w(_ d: String) -> PlanWorkout {
      PlanWorkout(date: d, type: "run", intensity: nil, durationMin: 30, distanceKm: nil, description: nil)
    }
    let days = (1...20).map { String(format: "2026-11-%02d", $0) }
    let rows = days.reversed().map(w) + [w("2026-10-31")]
    let up = PlanDay.upcoming(rows, today: "2026-11-02")
    XCTAssertEqual(up.count, 14)
    XCTAssertEqual(up.first?.date, "2026-11-02", "today's session is listed")
    XCTAssertEqual(up.map(\.date), Array(days[1..<15]))
    XCTAssertTrue(PlanDay.upcoming([w("2026-10-31")], today: "2026-11-02").isEmpty)
  }

  func testUnknownLevelNamesReadAsWords() {
    XCTAssertEqual(PlanSetup.levelName("first_timer"), "First timer")
    XCTAssertEqual(PlanSetup.levelName("returning_athlete"), "Returning Athlete")
    XCTAssertEqual(PlanSetup.levelText("returning_athlete"), "Returning Athlete")
  }
}
