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
        assertHittable(app.buttons["Sign Out"], "Sign Out")
        for name in ["Your plan", "This week", "Ask about your training", "Sign Out"] {
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
        XCTAssertGreaterThanOrEqual(e.frame.height, 44, "\(what) is at least 44 pt tall", file: file, line: line)
        XCTAssertGreaterThanOrEqual(e.frame.width, 44, "\(what) is at least 44 pt wide", file: file, line: line)
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

    func testLaunchPerformance() throws {
        if #available(macOS 10.15, iOS 13.0, tvOS 13.0, watchOS 7.0, *) {
            // This measures how long it takes to launch your application.
            measure(metrics: [XCTApplicationLaunchMetric()]) {
                XCUIApplication().launch()
            }
        }
    }
}
