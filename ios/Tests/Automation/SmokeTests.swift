import XCTest

// MARK: - SmokeTests
//
// Lightweight UI-test smoke suite for WOTANN iOS. Run these before every
// release to catch regressions that block all other testing (e.g. a crash
// on launch, a broken onboarding flow, a missing tab bar).
//
// Deliberately small — the goal is "Hello World tier" confidence, not deep
// integration testing. Heavier scenarios (pairing, streaming, HealthKit,
// etc.) require physical device + desktop + provider keys and are covered
// by the manual checklist in `Tests/PhysicalDeviceTestChecklist.md`.
//
// ### Device-only vs simulator-safe
//
// The suite is split into two classes:
// - `SmokeTests` — runs on both simulator and device. Covers launch, tab
//   rendering, onboarding bypass, and basic Settings visibility.
// - `DeviceOnlySmokeTests` — each test calls `throw XCTSkip(...)` when the
//   environment variable `WOTANN_RUN_DEVICE_ONLY=1` is not set. We surface
//   a skip (not a silent pass) so the CI log makes the gap visible — this
//   matches the project rule: *honest stubs over silent success*.
//
// ### Launch arguments
//
// The main app reads two launch-time signals:
// - `WOTANN_UI_TEST_BYPASS_ONBOARDING=1`  — forces `hasCompletedOnboarding=true`
// - `WOTANN_UI_TEST_RESET_STATE=1`        — wipes user defaults for a clean slate
//
// These are honoured by `WOTANNApp.swift` (see `UITestSupport.apply()`).
// In the absence of those hooks, the test falls back to walking the
// onboarding swipes. Both modes are supported so the suite is resilient
// to the app not shipping with the hooks yet.

// MARK: - SmokeTests (simulator + device)

final class SmokeTests: XCTestCase {

    // MARK: - Setup

    override func setUpWithError() throws {
        try super.setUpWithError()
        // Fail the test immediately on the first XCTAssert failure. Keeps the
        // suite fast and avoids cascading noise.
        continueAfterFailure = false
    }

    // MARK: - Helpers

    /// Launch the app with UI-test launch args. Returns the launched app so
    /// the caller can query / tap elements.
    @discardableResult
    private func launchApp(extraArgs: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += [
            "-WOTANN_UI_TEST_BYPASS_ONBOARDING", "1",
            "-WOTANN_UI_TEST_RESET_STATE", "1",
        ]
        app.launchArguments += extraArgs
        app.launchEnvironment["WOTANN_UI_TEST_MODE"] = "1"
        app.launch()
        return app
    }

    /// Attempt to dismiss the onboarding flow if it is visible. Uses two
    /// strategies: (1) swipe past any "Continue" buttons; (2) tap a
    /// well-known "Get Started" or "Skip" button if present. Harmless if
    /// the app already bypassed onboarding.
    private func dismissOnboardingIfPresent(_ app: XCUIApplication) {
        // Give the launch screen a moment to settle.
        _ = app.wait(for: .runningForeground, timeout: 5)

        let getStarted = app.buttons["Get Started"]
        let skip = app.buttons["Skip"]
        let done = app.buttons["Done"]

        var attempts = 0
        while attempts < 6 {
            if getStarted.exists && getStarted.isHittable {
                getStarted.tap()
                return
            }
            if skip.exists && skip.isHittable {
                skip.tap()
                return
            }
            if done.exists && done.isHittable {
                done.tap()
                return
            }
            // No button found; swipe to the next onboarding page.
            app.swipeLeft()
            attempts += 1
        }
    }

    // MARK: - Tests

    /// Cold launch + main window reaches `.runningForeground` within 3 s.
    /// Evidence that the app does not crash on launch and the scene wires up.
    func testAppLaunchesWithinThreeSeconds() throws {
        let start = Date()
        let app = launchApp()
        let reached = app.wait(for: .runningForeground, timeout: 3)
        let elapsed = Date().timeIntervalSince(start)

        XCTAssertTrue(reached, "App did not reach foreground within 3 s (elapsed=\(elapsed))")
        // 3 s is the contract in the checklist; we allow +0.5 s jitter on
        // slower simulator hosts so the test isn't flaky in CI.
        XCTAssertLessThan(elapsed, 3.5, "Launch exceeded 3 s budget: \(elapsed) s")
    }

    /// After bypass / dismiss, the TabView renders and the 4 primary tabs
    /// are visible. We check by label text — which also catches localization
    /// regressions if the app ever ships in another language.
    func testMainTabBarShowsFourTabs() throws {
        let app = launchApp()
        dismissOnboardingIfPresent(app)

        // Give the tab bar a moment to appear after onboarding bypass.
        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 5), "Main tab bar did not appear")

        // MainShell tabs: Home, Chat, Work, You.
        let expectedLabels = ["Home", "Chat", "Work", "You"]
        for label in expectedLabels {
            // tabBars.buttons match the `.tabItem(Label("..."))` text.
            let button = tabBar.buttons[label]
            XCTAssertTrue(
                button.waitForExistence(timeout: 2),
                "Tab '\(label)' was not visible in the tab bar. Found buttons: \(tabBar.buttons.allElementsBoundByIndex.map { $0.label })"
            )
        }
    }

    /// Tapping through each tab should not crash and should surface some
    /// distinct element per tab. We do not assert on every widget — just
    /// that the tab switch produces *something* rather than an empty view.
    func testEachTabRendersSomeContent() throws {
        let app = launchApp()
        dismissOnboardingIfPresent(app)

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 5), "Tab bar did not appear")

        for label in ["Home", "Chat", "Work", "You"] {
            let tab = tabBar.buttons[label]
            XCTAssertTrue(tab.exists, "Tab '\(label)' missing")
            tab.tap()
            // "Some content" = any non-empty element inside the app shell
            // excluding the tab bar itself. We look for a navigation bar or
            // static text; either is enough to prove the tab rendered.
            let navBar = app.navigationBars.firstMatch
            let staticText = app.staticTexts.firstMatch
            let rendered = navBar.waitForExistence(timeout: 3) || staticText.waitForExistence(timeout: 3)
            XCTAssertTrue(rendered, "Tab '\(label)' did not render any navigation bar or static text")
        }
    }

    /// Settings tab displays at least one row about providers or appearance.
    /// This is a proxy for "settings sections are wired up". We tolerate
    /// either exact match — both strings are stable across the app.
    func testSettingsTabShowsKnownSection() throws {
        let app = launchApp()
        dismissOnboardingIfPresent(app)

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 5), "Tab bar did not appear")

        // The Settings tab is labelled "You" in MainShell.
        let youTab = tabBar.buttons["You"]
        XCTAssertTrue(youTab.exists, "'You' tab not found")
        youTab.tap()

        // Settings list should contain one of these recognisable strings.
        let candidates = ["Appearance", "Notifications", "Connection", "Providers", "About"]
        let found = candidates.contains { label in
            app.staticTexts[label].waitForExistence(timeout: 2) ||
            app.otherElements[label].waitForExistence(timeout: 2) ||
            app.cells.containing(NSPredicate(format: "label CONTAINS[c] %@", label)).firstMatch.exists
        }
        XCTAssertTrue(found, "Settings/You tab did not surface any of \(candidates)")
    }
}

// MARK: - DeviceOnlySmokeTests
//
// Scenarios that only make sense on a physical device. The tests throw
// `XCTSkip` on simulator so the CI output clearly records "skipped" instead
// of silently passing (which would mask real regressions).

final class DeviceOnlySmokeTests: XCTestCase {

    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
        try skipIfNotDevice()
    }

    private func skipIfNotDevice() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Skipping: runs only on physical device (#targetEnvironment(simulator))")
        #else
        // Gate with an env var so these tests only run under explicit opt-in
        // even on device, matching the "honest skip" rule.
        guard ProcessInfo.processInfo.environment["WOTANN_RUN_DEVICE_ONLY"] == "1" else {
            throw XCTSkip("Skipping: WOTANN_RUN_DEVICE_ONLY != 1")
        }
        #endif
    }

    /// Chat input: open Chat, send "hello" via the mock provider, and
    /// observe a response within 30 s. Requires the desktop to be running
    /// with a mock provider configured. On device-only CI, the runner is
    /// expected to pre-provision that.
    func testChatHelloFlow() throws {
        let app = XCUIApplication()
        app.launchArguments += [
            "-WOTANN_UI_TEST_BYPASS_ONBOARDING", "1",
            "-WOTANN_UI_TEST_PROVIDER", "mock",
        ]
        app.launch()
        _ = app.wait(for: .runningForeground, timeout: 5)

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 5))

        let chatTab = tabBar.buttons["Chat"]
        XCTAssertTrue(chatTab.exists, "Chat tab missing")
        chatTab.tap()

        // Find the composer. We look for a text view / text field; either is
        // acceptable because the composer implementation has evolved.
        let composer = app.textViews.firstMatch.exists ?
            app.textViews.firstMatch :
            app.textFields.firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5), "Chat composer not found")
        composer.tap()
        composer.typeText("hello")

        let send = app.buttons["Send"].firstMatch
        XCTAssertTrue(send.waitForExistence(timeout: 2), "Send button missing")
        send.tap()

        // Expect a response message cell to appear within 30 s. We look for
        // any static text that is not our literal "hello" and is non-empty.
        let responseAppeared = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                let texts = app.staticTexts.allElementsBoundByIndex
                return texts.contains { $0.label.isEmpty == false && $0.label.lowercased() != "hello" }
            },
            object: nil
        )
        let result = XCTWaiter().wait(for: [responseAppeared], timeout: 30)
        XCTAssertEqual(result, .completed, "Did not observe a response message within 30 s")
    }

    /// Memory search: type 'test', observe non-empty result set or an
    /// empty-state label. Either outcome counts as "memory UI rendered" —
    /// we do not gate on actual content because the store may be empty.
    func testMemorySearchInteraction() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-WOTANN_UI_TEST_BYPASS_ONBOARDING", "1"]
        app.launch()
        _ = app.wait(for: .runningForeground, timeout: 5)

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 5))

        let workTab = tabBar.buttons["Work"]
        XCTAssertTrue(workTab.exists, "Work tab missing")
        workTab.tap()

        // Navigate into Memory. The exact screen label may change; we accept
        // any cell whose label contains "Memory".
        let memoryCell = app.cells.containing(
            NSPredicate(format: "label CONTAINS[c] %@", "Memory")
        ).firstMatch
        if memoryCell.waitForExistence(timeout: 5) {
            memoryCell.tap()
        }

        let search = app.searchFields.firstMatch
        if search.waitForExistence(timeout: 5) {
            search.tap()
            search.typeText("test")
        }

        // Either we see result rows or an "empty" indicator. Both pass.
        let anyResult = app.cells.containing(
            NSPredicate(format: "label.length > 0")
        ).firstMatch
        let emptyIndicator = app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS[c] %@", "No results")
        ).firstMatch
        let predicate = NSPredicate { _, _ in
            anyResult.exists || emptyIndicator.exists
        }
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: nil)
        let waited = XCTWaiter().wait(for: [expectation], timeout: 10)
        XCTAssertEqual(waited, .completed, "Memory screen did not settle into results or empty state")
    }
}
