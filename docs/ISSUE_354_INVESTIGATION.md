# Issue #354 — dock hit-area investigation

Investigated November 13, 2026 against 3.10.2 plus the merged triage chore
(`08d4a00`). [Report and follow-up settings](https://github.com/little-systems/bloom/issues/354).

Maintainer follow-up: opening four or five unpinned apps, clicking their icons,
and opening the Add App list did not reproduce the failure on the maintainer's
desktop. Higher-resolution TV testing remains pending. Preserve this change as
a candidate for further validation, not a confirmed resolution of #354.

## Confirmed defect

The visible dock and the native clickable rectangle can disagree permanently
after a running-app list change. This is reproducible using the actual React
Dock component with mocked Tauri IPC; it does not require a high-resolution TV.

The flow is:

1. `Dock.tsx` measures `dockRef.getBoundingClientRect()` in an effect and a
   `ResizeObserver`, then invokes `update_dock_rect`.
2. Adding running apps changes the layout. Framer Motion's `layout` projection
   temporarily transforms the new layout to resemble the old one.
3. The effect / resize observer can measure that old-looking transformed box.
4. The projection then animates to the new visible bounds. A transform change
   does not fire `ResizeObserver`, so the backend keeps the earlier hit box.
5. `services.rs::update_dock_interaction` checks the cursor against `DOCK_RECT`
   and makes the window click-through outside it. Visible icons outside the
   stale box therefore send clicks to the underlying app.

This establishes a mechanism for dead dock icons. It does not prove that every
symptom in #354 has this cause, or that this defect was introduced in 3.10.1:
the observer-only measurement path is also present in 3.10.0.

## Reproduction measurements

The browser harness imports the real Dock component, React, Framer Motion and
CSS, supplies nine running apps, then adds four more through the same
`windows-changed` event path used by Bloom. Tauri is mocked to record the
rectangles sent by the frontend; no native taskbar settings are changed.

| Scenario | Visible dock width after additions | Recorded hit width before fix | After fix |
| --- | --- | --- | --- |
| 1280 CSS px viewport, DPR 1, Bloom scale 1 | 693 | approximately 502 | 693 |
| 3413 CSS px viewport, DPR 1.5, Bloom scale 1 | 693 | approximately 505 | 693 |
| 3413 CSS px viewport, DPR 1.5, Bloom scale 1.5 | 1039.5 | approximately 757 | 1040 |

The 3413/DPR-1.5 case approximates the reporter's 5120 px / 150% display.
The reporter's attached settings do not specify `bloom-scale`, so scale 1 is
the relevant default; the scale-1.5 case checks an additional configuration.
Settings also enable icon-only mode and the dock separator, with a fixed notch.
Dock mode is absent and defaults to Smart; both Fixed and Smart were exercised.

Before the fix, four icon centers (two at each end) were outside even the
backend's generous 15-CSS-pixel padding/hysteresis envelope after four additions.
After the fix, every measured icon center is within the hit rectangle. The
precise stale width varies slightly with animation timing. The final visible
and reported rectangles match to rounding accuracy after the change.

## Local correction

On `codex/fix-dock-hit-geometry`, native geometry is refreshed from the dock's
motion updates and both ordinary-animation and layout-animation completion.
Unchanged rounded geometry is deduplicated, avoiding repeated identical IPC
writes. No background polling loop, clipping changes, DPI tolerance or broad
clickable-region expansion is added.

The completion callbacks matter: the observer can run before the layout
projection finishes even though the element's layout size has already changed.
The natural expanded overlap span remains independent of the animated hit box.

## Remaining symptoms and competing explanations

- **An app on the dock's right makes the entire dock unresponsive:** the harness
  verifies Smart overlap, hide and explicit edge-reveal recovery, but does not
  reproduce a complete freeze. Native overlap classification, z-order and actual
  Windows click-through behavior still need a desktop check. The mocked backend
  is not evidence that the Windows hook itself has been exercised.
- **Bloom Options submenu:** at the reporter's default Bloom scale, the measured
  submenu fits the existing native menu hit envelope within its padding. At
  Bloom scale 1.5, the guessed extra `160` CSS px leaves approximately 60 CSS px
  of the actual submenu's right edge outside the reported envelope. This is a
  separate measurable scaling defect, not evidence for the reporter's
  default-scale submenu failure. It is deliberately outside this patch.
- **Window-region clipping / PR #353:** the bottom band is full viewport width
  in these tests. Fractional pixel clipping cannot explain the roughly 190-CSS-px
  stale-width discrepancy reproduced here. Do not treat #353 as the fix for it.
- **General hangs:** thumbnail capture already runs on a blocking worker. No
  evidence from this investigation ties a slow capture to this report's freeze.

## Validation and next hardware check

- Frontend build (`bun run build`) passed.
- All 109 existing script tests (`bun test scripts`) passed.
- Browser before/after measurements passed for both viewport widths, both Bloom
  scales and Smart-mode hide/reveal. Browser page errors: none.
- Rust was not changed; no new Rust runtime validation is claimed.
- Local Bun is 1.3.11; repository CI specifies 1.4.0.

On the TV, make it the primary display, set 150% Windows scaling and use Bloom
scale 1, icon-only dock and Smart mode. Test the installed 3.10.2 first, then
the candidate build. Open several different unpinned apps, close them and reopen
them; check icons at both ends after each layout settles. Repeat with an app
window touching the right side of the expanded dock, then open Bloom Options
and move through its full submenu. Repeat once in Fixed dock mode to separate
overlap hiding from stale hit geometry. Record whether the dock is still
animating when clicks fail and whether an edge reveal restores it.

Do not close #354 until those remaining reported behaviors are checked.
