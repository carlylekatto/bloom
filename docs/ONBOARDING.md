# First-time setup

The existing `overlay` webview hosts one walkthrough of the live desktop:
welcome → Island introduction → Island visibility → Dock introduction → Dock
visibility → volume/brightness introduction → appearance/startup/update preferences → finish.
Introductions and options share a position near the corresponding surface, so each
page stays short. A single opaque card keeps the same dimensions throughout and
follows the selected appearance, including light text/control styling and adaptive
accent colors.
Curved arrows point toward the live Island and Dock from outside the card. On
smaller layouts with less space at the edge, the arrows sit inside the card.
Their bounds are included in the native window region so they remain visible.

The actual Island or Dock is temporarily revealed during its introduction, including in
Smart or Peek mode. This does not change the saved mode or enable a disabled
component. The visibility-options screens use normal hiding so mode changes can be tested live.
Leaving the introduction or closing the walkthrough restores normal hiding.

New installations select Island **Fixed** and Dock **Smart**. Startup and automatic
updates remain explicit choices; replay loads the current configuration.

Open **Settings → General → Welcome to Bloom → Open setup** to replay it.
All choices apply immediately: visibility uses the normal settings/event path,
startup uses the autostart plugin, and automatic updates use the persisted updater
preference. Failed changes leave the selected value unchanged and show an error.
Skipping or closing the walkthrough keeps choices already applied.

The compact Dark/Light/Adaptive Color choice also applies immediately. Replaying
setup preserves an existing Custom or Adaptive Accent theme until another mode is
explicitly selected. Adaptive Color seeds saturation and brightness from the Windows
accent, matching Settings. Custom Color remains available in Settings.
Command Center and its Settings shortcut are introduced in the Island copy;
the finish page also explains the Dock context-menu route to Settings.

Content fades out in place before changing pages. The card moves using a transform,
without resizing, and new text fades in without vertical movement. The window region
covers its travel path during motion and tightens afterward. Reduced motion removes
both the movement and fades; keyboard focus never scrolls the outgoing text.

## Lifecycle

`onboarding.json` in Tauri's app configuration directory stores only
`{"completed": true|false}`. It is independent of the application version,
`bloom-first-run`, settings import/reset, and the startup/update splash.

At backend startup, before the settings cache is initialized:

- An existing settings file migrates to completed, avoiding an unsolicited wizard
  for existing users after an upgrade.
- A fresh installation writes pending immediately. If setup is interrupted,
  creating settings later does not accidentally mark it completed.
- A pending installation opens setup after the normal splash. Upgrading a
  completed installation only plays the existing version splash.

The overlay takes keyboard focus while setup is open and reports the panel bounds
as its native window region. Outside the panel, the desktop remains accessible.
On dismissal it returns to the HUD's normal click-through behavior and restores
the preceding foreground window when available.

## Manual verification

1. Run `bun run tauri dev`, open Settings, and use **Open setup**.
2. Follow the live Island and Dock introductions, check both visibility selectors,
   save preferences, and finish. Verify the chosen modes apply and temporary
   reveals end when leaving each surface.
3. Replay setup and confirm it reflects the saved choices. Close with Escape and
   confirm keyboard focus and normal volume/brightness overlays recover.
4. Check a smaller screen and Windows scaling above 100%, including larger Bloom
   scaling. Verify buttons and guide cards remain visible.
5. On a clean Windows user/profile, verify automatic setup runs once after the
   splash and does not recur after completion or an application version change.
