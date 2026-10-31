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
