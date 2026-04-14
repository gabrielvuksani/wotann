---
name: playwright-expert
description: E2E testing, visual regression, browser automation
context: fork
paths: ["**/playwright*", "**/*.spec.ts"]
requires:
  bins: ["npx"]
---
# Playwright Expert
## Rules
- Use locators (getByRole, getByText, getByTestId) not CSS selectors.
- Use auto-waiting (don't add explicit waits).
- Use page.route() for API mocking in tests.
- Run in headless CI, headed locally for debugging.
## Patterns
- Page Object Model for maintainable tests.
- Visual regression with toHaveScreenshot().
- Network interception for offline/error testing.
- Trace viewer for debugging failures.
## Anti-Patterns
- Fragile selectors (nth-child, complex CSS paths).
- Fixed timeouts (use auto-wait or expect).
- Testing implementation details instead of user behavior.
