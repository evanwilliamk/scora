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

    func testLaunchPerformance() throws {
        if #available(macOS 10.15, iOS 13.0, tvOS 13.0, watchOS 7.0, *) {
            // This measures how long it takes to launch your application.
            measure(metrics: [XCTApplicationLaunchMetric()]) {
                XCUIApplication().launch()
            }
        }
    }
}
