//
//  ScoraUITests.swift
//  ScoraUITests
//
//  Created by everett kosowski on 7/2/26.
//

import XCTest

final class ScoraUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    func testExample() throws {
        // UI tests must launch the application that they test.
        let app = XCUIApplication()
        app.launch()

        // Use XCTAssert and related functions to verify your tests produce the correct results.
    }

    // Smoke tests on the DEBUG demo data (DemoMode.swift): no sign-in, no
    // network, and nothing tapped that would call the API.

    func testDashboardShowsTheNumbersFirstAndWeekSoFar() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read"]
        app.launch()
        XCTAssertTrue(app.staticTexts["TODAY'S READ"].waitForExistence(timeout: 10) || app.staticTexts["Today's Read"].exists)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Sleep 7:12'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'since Monday'")).firstMatch.exists)
    }

    func testYourPlanShowsPastSessionsAndSendToWatch() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-plan", "-demo-plan-sessions"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Your Plan"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Missed"].waitForExistence(timeout: 5), "a past session can be marked")
        XCTAssertGreaterThanOrEqual(app.buttons.matching(identifier: "Send to Watch").count, 1)
        XCTAssertTrue(app.buttons["Paste or import a new plan"].exists)
        let missed = app.buttons["Missed"]
        XCTAssertTrue(missed.label.hasPrefix("Mark ") && missed.label.hasSuffix(", as missed"), "VoiceOver names the session: \(missed.label)")
    }

    func testYourPlanShowsTheBlock() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-plan", "-demo-plan-sessions"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Week 4 of 12 · Base"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Half marathon, Dec 27"].exists)
    }

    func testThisWeekOffersShare() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-weekly"]
        app.launch()
        XCTAssertTrue(app.staticTexts["SUNDAY REVIEW"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Share this week's review"].waitForExistence(timeout: 5))
    }

    func testDashboardIconButtonsHaveLabels() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read"]
        app.launch()
        XCTAssertTrue(app.buttons["This week"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Ask about your training"].exists)
    }

    func testDashboardShowsPlanTodayCard() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-cards"]
        app.launch()
        // Each card is one VoiceOver element, read as its title then its numbers.
        let plan = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Plan today, 45 min, tempo.'")).firstMatch
        XCTAssertTrue(plan.waitForExistence(timeout: 10))
    }

    func testDashboardCardsAndWeekBarsHaveSpokenLabels() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-cards"]
        app.launch()
        let sleep = app.buttons.matching(NSPredicate(format: "label == 'Sleep, 7:12 hrs, Oura 84. From Oura.'")).firstMatch
        XCTAssertTrue(sleep.waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["Monday, 40 minutes, plan 40 minutes"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["Friday, still ahead"].exists)
    }

    func testPlanSetupFormOpens() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-plan", "-demo-plan-setup"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Build a plan"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Build my plan"].exists)
        XCTAssertTrue(app.staticTexts["First timer or first serious block"].exists)
        // Weekly volume asks in miles (Q32 B): first timer takes 15 to 30 km, so 18 mi tops it.
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "18 mi a week")).firstMatch.exists)
    }

    // Accessibility pass: the key screens at the largest accessibility text
    // size (AX5), on the DEBUG demo data. Key controls exist and can be tapped.

    func testSettingsOpensFromTheDashboardAndSignsOut() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-cards"]
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Morning read"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.datePickers.firstMatch.waitForExistence(timeout: 5), "saved time on the wheel")
        XCTAssertFalse(app.buttons["Save time"].exists, "nothing to save until the time changes")
        XCTAssertTrue(scrollTo(app.buttons["Reconnect Strava"], in: app))
        XCTAssertTrue(app.staticTexts["Connections"].exists)
        XCTAssertTrue(scrollTo(app.buttons["Reconnect Oura"], in: app), "the sample read has a ring")
        XCTAssertTrue(scrollTo(app.buttons["Sign Out"], in: app))
        app.buttons["Sign Out"].tap()
        XCTAssertTrue(app.buttons["Sign in with Strava"].waitForExistence(timeout: 5))
    }

    func testSettingsSavesAChangedTime() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-settings"]
        app.launch()
        let wheel = app.pickerWheels.firstMatch
        XCTAssertTrue(wheel.waitForExistence(timeout: 10))
        wheel.adjust(toPickerWheelValue: "7")
        XCTAssertTrue(app.buttons["Save time"].waitForExistence(timeout: 5))
        app.buttons["Save time"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Saved. Your read arrives at 7:30'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Save time"].exists)
    }

    func testSettingsSaveFailureSaysSo() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-settings", "-demo-delivery-fails"]
        app.launch()
        let wheel = app.pickerWheels.firstMatch
        XCTAssertTrue(wheel.waitForExistence(timeout: 10))
        wheel.adjust(toPickerWheelValue: "7")
        XCTAssertTrue(app.buttons["Save time"].waitForExistence(timeout: 5))
        app.buttons["Save time"].tap()
        XCTAssertTrue(app.staticTexts["Could not save the time. Your read keeps its current time."].waitForExistence(timeout: 5))
    }

    func testSettingsLoadFailureOffersTryAgainNotADefaultTime() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-settings-load-fails"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Could not load your delivery time."].waitForExistence(timeout: 10))
        XCTAssertFalse(app.datePickers.firstMatch.exists)
        assertTarget(app.buttons["Try again"], "Try again", in: app)
    }

    // Sample read kept on the phone says no ring; the live load has not answered.
    func testSettingsClaimsNothingFromAReadKeptOnThePhone() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-kept-read", "-demo-settings"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Morning read"].waitForExistence(timeout: 10))
        XCTAssertTrue(scrollTo(app.buttons["Reconnect Strava"], in: app))
        let unknown = "Shows once today's read has loaded."
        XCTAssertTrue(connectionLine("Strava", unknown, in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(connectionLine("Oura", unknown, in: app).exists)
        XCTAssertFalse(connectionLine("Strava", "Connected.", in: app).exists)
    }

    func testSettingsSaysConnectedAfterALiveRead() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-cards"]
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
        app.buttons["Settings"].tap()
        XCTAssertTrue(scrollTo(app.buttons["Reconnect Strava"], in: app))
        XCTAssertTrue(connectionLine("Strava", "Connected.", in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(connectionLine("Oura", "Connected.", in: app).exists)
    }

    func testOuraLinkShowsConnectedEvenWhenTheReloadFails() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-read-fails", "-demo-settings", "-demo-link", "scora://oura/success"]
        app.launch()
        XCTAssertTrue(connectionLine("Oura", "Connected.", in: app).waitForExistence(timeout: 10))
    }

    func testBannerWaitingWhenTheDashboardAppearsIsShown() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-demo-waiting-banner"]
        app.launch()
        XCTAssertTrue(any("Strava connected.", in: app).waitForExistence(timeout: 10))
    }

    // The flag comes from the launch arguments, so nothing stays on the simulator.
    func testDeclinedReconnectLinkShowsItsBanner() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-scora.stravaReconnectFor", "1", "-demo-link", "scora://auth/failed?reason=cancelled"]
        app.launch()
        XCTAssertTrue(any("Strava was not reconnected. Nothing changed.", in: app).waitForExistence(timeout: 10))
    }

    func testOtherAccountLinkLeavesTheDashboardAlone() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-read", "-scora.stravaReconnectFor", "1", "-demo-link", "scora://auth/success?athlete_id=2&name=Other&token=test-token"]
        app.launch()
        XCTAssertTrue(any("That was a different Strava account. Nothing changed.", in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Settings"].exists)
    }

    // A connection is one VoiceOver stop, so its name and line read together.
    private func connectionLine(_ name: String, _ line: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", name, line)).firstMatch
    }

    func testSettingsAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-read", "-demo-cards", "-demo-settings"])
        assertHittable(app.buttons["Done"], "Done")
        XCTAssertTrue(app.staticTexts["Morning read"].waitForExistence(timeout: 10))
        XCTAssertTrue(scrollTo(app.buttons["Reconnect Strava"], in: app))
        assertTarget(app.buttons["Reconnect Strava"], "Reconnect Strava", in: app)
        XCTAssertTrue(scrollTo(app.buttons["Sign Out"], in: app))
        assertTarget(app.buttons["Sign Out"], "Sign Out", in: app)
    }

    private func launchAtAX5(_ args: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = args + ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        return app
    }

    private func assertHittable(_ e: XCUIElement, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(e.waitForExistence(timeout: 10), "\(what) exists", file: file, line: line)
        XCTAssertTrue(e.isHittable, "\(what) can be tapped", file: file, line: line)
    }

    // At AX5 lower content starts off screen (and lazy stacks have not built
    // it yet), so swipe until it shows.
    private func scrollTo(_ e: XCUIElement, in app: XCUIApplication) -> Bool {
        for _ in 0..<8 where !(e.exists && e.isHittable) { app.swipeUp() }
        return e.exists && e.isHittable
    }

    func testDashboardAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-read", "-demo-cards"])
        assertHittable(app.buttons["Your plan"], "Your plan")
        assertHittable(app.buttons["This week"], "This week")
        assertHittable(app.buttons["Ask about your training"], "Ask about your training")
        assertHittable(app.buttons["Settings"], "Settings")
        for name in ["Your plan", "This week", "Ask about your training", "Settings"] {
            let f = app.buttons[name].frame
            XCTAssertGreaterThanOrEqual(f.height, 44, "\(name) is at least 44 pt tall")
            XCTAssertGreaterThanOrEqual(f.width, 44, "\(name) is at least 44 pt wide")
        }
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Sleep 7:12'")).firstMatch.exists)
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sleep, 7:12 hrs'")).firstMatch
        XCTAssertTrue(scrollTo(card, in: app), "the Sleep card can be reached and tapped")
    }

    func testDriverChartAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-read", "-demo-chart"])
        let chart = app.descendants(matching: .any)["Chart of HRV, nightly average"]
        XCTAssertTrue(chart.waitForExistence(timeout: 10))
        let value = chart.value as? String ?? ""
        XCTAssertTrue(value.contains("Latest 52 ms") && value.contains("Low 41 ms, high 52 ms"), "chart reads its own numbers: \(value)")
        assertHittable(app.buttons["Done"], "Done")
    }

    func testChatAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-read", "-demo-chat"])
        let chart = app.descendants(matching: .any)["Chart for this answer"]
        XCTAssertTrue(chart.waitForExistence(timeout: 10))
        XCTAssertEqual(chart.value as? String, "HRV (ms) by Week. 8 values, from 1 to 8. First 41, last 52. Low 41, high 52.")
        assertHittable(app.buttons["Send"], "Send")
        assertHittable(app.textFields["Message"], "Message field")
    }

    func testThisWeekAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-read", "-demo-weekly"])
        assertHittable(app.buttons["Share this week's review"], "Share")
        XCTAssertTrue(app.staticTexts["SUNDAY REVIEW"].exists)
    }

    func testYourPlanAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-read", "-demo-plan", "-demo-plan-sessions"])
        XCTAssertTrue(app.staticTexts["Your Plan"].waitForExistence(timeout: 10))
        assertHittable(app.buttons["Done"], "Done")
        let watch = app.buttons.matching(identifier: "Send to Watch").firstMatch
        XCTAssertTrue(watch.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(watch.frame.height, 44, "Send to Watch is at least 44 pt tall")
    }

    func testPlanSetupAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-read", "-demo-plan", "-demo-plan-setup"])
        XCTAssertTrue(app.staticTexts["Build a plan"].waitForExistence(timeout: 10))
        assertHittable(app.buttons["Cancel"], "Cancel")
        XCTAssertTrue(scrollTo(app.buttons["Build my plan"], in: app), "Build my plan can be reached and tapped")
    }

    // Sign-in and onboarding on the DEBUG demo modes (DemoMode.swift): no
    // network, no system prompts, nothing stored.

    private func step(_ n: Int, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["Step \(n) of 5"]
    }

    private func assertTarget(_ e: XCUIElement, _ what: String, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(e.waitForExistence(timeout: 10), "\(what) exists", file: file, line: line)
        XCTAssertTrue(scrollTo(e, in: app), "\(what) can be reached and tapped", file: file, line: line)
        // A frame of exactly 44 pt can come back as 43.99999.
        XCTAssertGreaterThanOrEqual(e.frame.height, 43.99, "\(what) is at least 44 pt tall", file: file, line: line)
        XCTAssertGreaterThanOrEqual(e.frame.width, 43.99, "\(what) is at least 44 pt wide", file: file, line: line)
    }

    func testSignInScreen() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-signin"]
        app.launch()
        XCTAssertTrue(app.staticTexts["SCORA"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Endurance athlete insights"].exists)
        assertTarget(app.buttons["Sign in with Strava"], "Sign in with Strava", in: app)
    }

    func testSignInAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-signin"])
        XCTAssertTrue(app.staticTexts["SCORA"].waitForExistence(timeout: 10))
        assertTarget(app.buttons["Sign in with Strava"], "Sign in with Strava", in: app)
    }

    // Walks every step forward the way an athlete would and ends on the dashboard.
    private func walkOnboarding(_ app: XCUIApplication) {
        XCTAssertTrue(step(1, in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Got an Oura ring? Add it."].exists)
        assertTarget(app.buttons["Connect Oura"], "Connect Oura", in: app)
        assertTarget(app.buttons["Skip for now"], "Skip for now", in: app)
        app.buttons["Connect Oura"].tap()

        XCTAssertTrue(step(2, in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Apple Health"].exists)
        assertTarget(app.buttons["Allow Apple Health"], "Allow Apple Health", in: app)
        app.buttons["Allow Apple Health"].tap()

        XCTAssertTrue(step(3, in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Have a training plan?"].exists)
        assertTarget(app.buttons["Paste a plan"], "Paste a plan", in: app)
        assertTarget(app.buttons["Skip"], "Skip", in: app)
        app.buttons["Skip"].tap()

        XCTAssertTrue(step(4, in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Morning read"].exists)
        XCTAssertTrue(app.datePickers.firstMatch.exists, "delivery time picker")
        assertTarget(app.buttons["Continue"], "Continue", in: app)
        app.buttons["Continue"].tap()

        XCTAssertTrue(step(5, in: app).waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Your first read lands'")).firstMatch.exists)
        assertTarget(app.buttons["Go to today"], "Go to today", in: app)
        app.buttons["Go to today"].tap()

        XCTAssertTrue(app.buttons["This week"].waitForExistence(timeout: 10), "onboarding ends on the dashboard")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Sleep 7:12'")).firstMatch.exists)
    }

    func testOnboardingWalksToDashboard() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-onboarding"]
        app.launch()
        walkOnboarding(app)
    }

    func testOnboardingAtAccessibilityTextSize() throws {
        walkOnboarding(launchAtAX5(["-demo-onboarding"]))
    }

    func testOnboardingSkipsLeadToDashboard() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo-onboarding"]
        app.launch()
        XCTAssertTrue(app.buttons["Skip for now"].waitForExistence(timeout: 10))
        app.buttons["Skip for now"].tap()
        XCTAssertTrue(step(2, in: app).waitForExistence(timeout: 5), "skipping Oura lands on Apple Health")
    }

    // A failed time save offers Skip for now, which moves on to the last step.
    func testDeliverySaveFailureAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-onboarding-step", "delivery", "-demo-delivery-fails"])
        XCTAssertTrue(step(4, in: app).waitForExistence(timeout: 10))
        assertTarget(app.buttons["Continue"], "Continue", in: app)
        app.buttons["Continue"].tap()
        let skip = app.buttons["Skip for now"]
        assertTarget(skip, "Skip for now", in: app)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Could not save the time.'")).firstMatch.exists)
        skip.tap()
        XCTAssertTrue(step(5, in: app).waitForExistence(timeout: 5))
    }

    func testEachOnboardingStepOpensOnItsOwn() throws {
        let expected: [(String, String, String)] = [
            ("oura", "Got an Oura ring? Add it.", "Connect Oura"),
            ("health", "Apple Health", "Allow Apple Health"),
            ("plan", "Have a training plan?", "Paste a plan"),
            ("delivery", "Morning read", "Continue"),
            ("done", "Your first read lands", "Go to today"),
        ]
        for (i, (name, title, button)) in expected.enumerated() {
            let app = launchAtAX5(["-demo-onboarding-step", name])
            XCTAssertTrue(step(i + 1, in: app).waitForExistence(timeout: 10), "\(name) is step \(i + 1)")
            XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch.exists, "\(name) title")
            assertTarget(app.buttons[button], "\(name): \(button)", in: app)
            app.terminate()
        }
    }

    // Screens and sheets not covered above, each at the default text size and
    // at AX5, on the DEBUG demo data (DemoMode.swift). Nothing tapped calls
    // the API: the demo answers every request on the phone.

    private func launch(_ args: [String], ax5: Bool) -> XCUIApplication {
        if ax5 { return launchAtAX5(args) }
        let app = XCUIApplication()
        app.launchArguments = args
        app.launch()
        return app
    }

    private func any(_ label: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[label]
    }

    private func checkCardExpansion(ax5: Bool) {
        let app = launch(["-demo-read", "-demo-cards"], ax5: ax5)
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sleep, 7:12 hrs'")).firstMatch
        _ = scrollTo(card, in: app) // below the fold at AX5
        assertTarget(card, "Sleep card", in: app)
        card.tap()
        let open = NSPredicate(format: "value == %@", "Slept 7:12 last night, Oura score 84.")
        expectation(for: open, evaluatedWith: card)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.staticTexts["Slept 7:12 last night, Oura score 84."].exists, "the explanation shows on the card")
        card.tap()
        expectation(for: NSPredicate(format: "value == ''"), evaluatedWith: card)
        waitForExpectations(timeout: 5)
    }

    func testCardExpansion() throws { checkCardExpansion(ax5: false) }
    func testCardExpansionAtAccessibilityTextSize() throws { checkCardExpansion(ax5: true) }

    private func checkOuraConnectCard(ax5: Bool) {
        let app = launch(["-demo-read", "-demo-cards", "-demo-oura-missing"], ax5: ax5)
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sleep, Connect Oura to see sleep and recovery.'")).firstMatch
        _ = scrollTo(card, in: app) // below the fold at AX5
        assertTarget(card, "Connect Oura card", in: app)
        XCTAssertTrue(app.staticTexts["Connect Oura to see sleep and recovery."].exists || card.label.contains("Connect Oura"))
    }

    func testOuraConnectCard() throws { checkOuraConnectCard(ax5: false) }
    func testOuraConnectCardAtAccessibilityTextSize() throws { checkOuraConnectCard(ax5: true) }

    private func checkOuraBanner(ax5: Bool) {
        let app = launch(["-demo-read", "-demo-oura-banner"], ax5: ax5)
        let banner = any("Oura connected. Sleep and recovery now read from your ring.", in: app)
        assertTarget(banner, "Oura banner", in: app)
        banner.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: banner)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.buttons["This week"].exists, "the dashboard stays")
    }

    func testOuraConnectedBanner() throws { checkOuraBanner(ax5: false) }
    func testOuraConnectedBannerAtAccessibilityTextSize() throws { checkOuraBanner(ax5: true) }

    private func checkReadError(ax5: Bool) {
        let app = launch(["-demo-read", "-demo-read-fails"], ax5: ax5)
        XCTAssertTrue(app.staticTexts["TODAY'S READ"].waitForExistence(timeout: 10) || app.staticTexts["Today's Read"].exists, "title")
        let line = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'read'")).element(boundBy: 1)
        XCTAssertTrue(line.waitForExistence(timeout: 5), "the error line shows")
        XCTAssertFalse(app.staticTexts["Pull to refresh your read."].exists, "no second prompt under the error")
        for name in ["Your plan", "This week", "Ask about your training"] {
            assertTarget(app.buttons[name], name, in: app)
        }
    }

    func testReadErrorState() throws { checkReadError(ax5: false) }
    func testReadErrorStateAtAccessibilityTextSize() throws { checkReadError(ax5: true) }

    func testDriverChart() throws {
        let app = launch(["-demo-read", "-demo-chart"], ax5: false)
        let chart = any("Chart of HRV, nightly average", in: app)
        XCTAssertTrue(chart.waitForExistence(timeout: 10))
        XCTAssertTrue((chart.value as? String ?? "").contains("Low 41 ms, high 52 ms"))
        assertTarget(app.buttons["Done"], "Done", in: app)
    }

    func testWeekSoFarAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-read"])
        let line = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'since Monday'")).firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 10))
        let monday = any("Monday, 40 minutes, plan 40 minutes", in: app)
        XCTAssertTrue(scrollTo(monday, in: app) || monday.exists, "the week bars have spoken labels")
        XCTAssertTrue(any("Friday, still ahead", in: app).exists)
    }

    func testChat() throws {
        let app = launch(["-demo-read", "-demo-chat"], ax5: false)
        let chart = any("Chart for this answer", in: app)
        XCTAssertTrue(chart.waitForExistence(timeout: 10))
        XCTAssertEqual(chart.value as? String, "HRV (ms) by Week. 8 values, from 1 to 8. First 41, last 52. Low 41, high 52.")
        assertTarget(app.buttons["Send"], "Send", in: app)
        assertTarget(app.buttons["Share this answer and chart"], "Share answer", in: app)
    }

    func testChatShareAtAccessibilityTextSize() throws {
        let app = launchAtAX5(["-demo-read", "-demo-chat"])
        XCTAssertTrue(any("Chart for this answer", in: app).waitForExistence(timeout: 10))
        assertTarget(app.buttons["Share this answer and chart"], "Share answer", in: app)
    }

    private func checkThisWeek(ax5: Bool) {
        let app = launch(["-demo-read", "-demo-weekly"], ax5: ax5)
        XCTAssertTrue(app.staticTexts["SUNDAY REVIEW"].waitForExistence(timeout: 10))
        assertTarget(app.buttons["Share this week's review"], "Share", in: app)
    }

    func testThisWeekTargets() throws { checkThisWeek(ax5: false) }

    private func checkPlanChanges(ax5: Bool) {
        let app = launch(["-demo-read", "-demo-plan", "-demo-plan-sessions", "-demo-plan-changes"], ax5: ax5)
        XCTAssertTrue(app.staticTexts["Your Plan"].waitForExistence(timeout: 10))
        let reason = app.staticTexts["Tuesday's tempo moved to Wednesday because you slept 5.5 hours Monday."]
        XCTAssertTrue(reason.waitForExistence(timeout: 5), "a change shows its reason")
        let dismiss = app.buttons.matching(identifier: "Dismiss this plan change").firstMatch
        assertTarget(dismiss, "Dismiss this plan change", in: app)
        dismiss.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: reason)
        waitForExpectations(timeout: 5)

        let all = app.buttons["All plan changes"]
        assertTarget(all, "All plan changes", in: app)
        all.tap()
        XCTAssertTrue(app.navigationBars["Plan changes"].waitForExistence(timeout: 5) || app.staticTexts["Plan changes"].exists, "history title")
        XCTAssertTrue(app.staticTexts["Dismissed"].waitForExistence(timeout: 5), "history keeps dismissed changes")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Thursday'")).firstMatch.exists)
        let done = app.navigationBars.buttons["Done"]
        assertTarget(done, "History Done", in: app)
        done.tap()
        XCTAssertTrue(app.staticTexts["Your Plan"].waitForExistence(timeout: 5), "back on Your Plan")
    }

    func testPlanChangesAndHistory() throws { checkPlanChanges(ax5: false) }
    func testPlanChangesAndHistoryAtAccessibilityTextSize() throws { checkPlanChanges(ax5: true) }

    private func checkPlanLoadFails(ax5: Bool) {
        let app = launch(["-demo-read", "-demo-plan", "-demo-plan-fails"], ax5: ax5)
        XCTAssertTrue(app.staticTexts["Your Plan"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Your plan did not load. Try again in a moment."].waitForExistence(timeout: 5))
        assertTarget(app.buttons["Try again"], "Try again", in: app)
        assertTarget(app.buttons["Done"], "Done", in: app)
    }

    func testPlanLoadFailure() throws { checkPlanLoadFails(ax5: false) }
    func testPlanLoadFailureAtAccessibilityTextSize() throws { checkPlanLoadFails(ax5: true) }

    private func checkPlanChangesFail(ax5: Bool) {
        let app = launch(["-demo-read", "-demo-plan", "-demo-plan-sessions", "-demo-plan-fails"], ax5: ax5)
        XCTAssertTrue(app.staticTexts["Your Plan"].waitForExistence(timeout: 10))
        let line = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Plan changes did not load'")).firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 5))
        assertTarget(app.buttons["Try again"], "Try again", in: app)
    }

    func testPlanChangesLoadFailure() throws { checkPlanChangesFail(ax5: false) }
    func testPlanChangesLoadFailureAtAccessibilityTextSize() throws { checkPlanChangesFail(ax5: true) }

    private func checkPasteAPlan(ax5: Bool) {
        let app = launch(["-demo-read", "-demo-plan"], ax5: ax5)
        XCTAssertTrue(app.staticTexts["Your Plan"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Have a training plan?"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Your plan did not load. Try again in a moment."].exists)
        assertTarget(app.buttons["Done"], "Done", in: app)
        assertTarget(app.buttons["Save plan"], "Save plan", in: app)
        assertTarget(app.buttons["Import"], "Import", in: app)
    }

    func testPasteAPlan() throws { checkPasteAPlan(ax5: false) }
    func testPasteAPlanAtAccessibilityTextSize() throws { checkPasteAPlan(ax5: true) }

    func testYourPlanTargets() throws {
        let app = launch(["-demo-read", "-demo-plan", "-demo-plan-sessions"], ax5: false)
        XCTAssertTrue(app.staticTexts["Your Plan"].waitForExistence(timeout: 10))
        assertTarget(app.buttons["Done"], "Done", in: app)
        assertTarget(app.buttons.matching(identifier: "Send to Watch").firstMatch, "Send to Watch", in: app)
        assertTarget(app.buttons["Missed"], "Missed", in: app)
    }

    func testLaunchPerformance() throws {
        if #available(macOS 10.15, iOS 13.0, tvOS 13.0, watchOS 7.0, *) {
            // This measures how long it takes to launch your application.
            measure(metrics: [XCTApplicationLaunchMetric()]) {
                XCUIApplication().launch()
            }
        }
    }
}
