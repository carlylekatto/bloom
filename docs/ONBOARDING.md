# First-time setup

Setup and the quick guide use the existing `overlay` webview. The welcome
introduces the Island and Dock together, followed by separate visibility
choices, startup/update preferences, and a short guide. New installations start
with Island **Fixed** and Dock **Smart**. Startup and automatic updates are
explicit choices; replaying setup loads the current choices.

Open **Settings → General → Welcome to Bloom → Open setup** to replay it.
No localStorage edits or settings reset are necessary. Choices are drafts until
**Show me around** or **I'll explore** saves them. Closing setup before saving
keeps the existing configuration. Closing or skipping dismisses automatic setup;
the replay action remains available.

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
2. Check both visibility selectors, save preferences, and finish the three guide
   cards. Verify Island and Dock respond to the saved modes.
3. Replay setup and confirm it reflects the saved choices. Close with Escape and
   confirm keyboard focus and normal volume/brightness overlays recover.
4. Check a smaller screen and Windows scaling above 100%, including larger Bloom
   scaling. Verify buttons and guide cards remain visible.
5. On a clean Windows user/profile, verify automatic setup runs once after the
   splash and does not recur after completion or an application version change.
