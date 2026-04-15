---
name: computer-use
description: Automate GUI interactions, visually verify UI changes, and perform tasks requiring real eyes-and-hands on the screen. Use for browser automation, desktop control, and visual verification flows.
---

# Computer Use — Full Desktop Control

Use when: automating GUI interactions, visual verification of UI changes,
browser automation, or any task requiring eyes and hands on the actual screen.

## Architecture
WOTANN Computer Use = Perception Engine + Platform Bindings + Action DSL

### Perception Engine
- Screenshot analysis via vision model (Opus/GPT-4o with vision)
- OCR for text extraction from screenshots
- Element detection (buttons, text fields, links, menus)
- Screen state diffing (before/after comparison)
- Accessibility tree reading (preferred over screenshots when available)

### Platform Bindings
- **macOS**: AppleScript + cliclick + screencapture
- **Linux**: xdotool + scrot + xdg-open
- **Windows**: PowerShell + nircmd + screenshot API

### Action DSL
```
CLICK(x, y)                    # Click at coordinates
CLICK_ELEMENT("Submit")        # Click element by text/label
TYPE("hello world")            # Type text
KEY(cmd+s)                     # Press key combination
SCROLL(direction, amount)      # Scroll
WAIT(ms)                       # Wait
SCREENSHOT()                   # Take screenshot
READ_SCREEN()                  # OCR the current screen
DRAG(x1, y1, x2, y2)          # Drag and drop
```

## Use Cases
1. **Visual Verification**: After modifying CSS/React, take screenshot and verify layout
2. **Browser Automation**: Navigate web apps, fill forms, extract data
3. **IDE Automation**: Open files, run commands not available via CLI
4. **App Testing**: UI regression testing via screenshot comparison
5. **Demo Recording**: Capture sequences of actions for documentation

## Safety
- Require user confirmation before first desktop action in a session
- Never interact with windows outside the target application
- Screenshot privacy: mask sensitive areas (password fields, financial data)
- Action replay logging: every action recorded for audit and undo
