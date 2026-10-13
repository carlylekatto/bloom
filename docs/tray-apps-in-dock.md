# Tray apps in the dock — open design question

Status: **open**. Shipped a mitigation (a setting); the underlying design is
still wrong. Written down so the next person does not rediscover it from a
misclick.

## The symptom

An app that closes its window to the system tray — Cisco App, Unikey,
OpenKey, and others — keeps a lit icon in Bloom's dock. The user expects it to
leave, the way the Windows taskbar hides it behind the tray overflow. Right
clicking the icon opens Windows' own tray menu for that app instead of
Bloom's context menu.

## It is upstream behaviour, not a fork bug

Introduced by `5792ce3`, PR #168, "keep background tray apps in the dock and
add notch panel arrows", by Dhanush Santosh, 2026-10-09. The same commit wrote
both halves of the behaviour: keeping the icon, and hijacking right click.

## The window enumeration is not at fault

Checked first, because "the dock forgot to filter hidden windows" is the
obvious suspect and it is wrong here.

`src-tauri/src/services.rs:3504` filters on `IsWindowVisible`, and also checks
`DWMWA_CLOAKED` for shell-cloaked and suspended windows. Both are correct.

Enumerating every top-level window of a closed-to-tray OpenKey64 on the
reporting machine:

```
hwnd=0x350066   vis=False   rect=(77,77)-(1229,777)  1152x700
hwnd=0x87002BE  vis=False   rect=0x0
hwnd=0x3C0CF6   vis=False   rect=0x0
```

All three are `IsWindowVisible = FALSE`. The app hid its window properly with
`SW_HIDE`. `EnumWindows` filters them out.

## Where the icon actually comes from

`src/Dock.tsx` polls two sources and merges them:

```tsx
const [windows, tray] = await Promise.all([
    invoke<AppInfo[]>("get_active_windows"),
    invoke<TrayApp[]>("get_tray_apps").catch(() => [])
]);
```

- `selectDockTrayApps` (`src/dockApps.ts:32`) marks a tray icon eligible once its
  app has been seen with a window, or if pinned.
- `mergeTrayApps` (`src/dockApps.ts:54`) then appends every eligible tray app
  with `is_background: true` and no windows.

So the sequence is: OpenKey opens a window, it is observed; you close the
window; the window list is now empty for it, but the tray entry still is, and
the merge puts it back. The dock is showing the tray, not a stale window.

## Why it is a footgun, not a preference

A background dock item is visually identical to a running app icon. The user
cannot tell that it is a tray icon, so muscle memory applies and the usual
assumption — "that app is open" — sends them to click it.

**Left click** (`Dock.tsx:649`):

```tsx
} else if (app.is_background && app.tray_ids?.length === 1) {
    await invoke("activate_tray_icon", { trayId: app.tray_ids[0] });
}
```

This forwards whatever the tray icon does on a left click. For most apps that
is "restore the window", which is harmless. For an app whose tray click does
something else, the user has no idea they just triggered it.

**Right click** (`Dock.tsx:713`):

```tsx
if (app?.is_background && app.tray_ids?.length === 1 && !e.shiftKey) {
    void openTrayMenu(app.tray_ids[0]);
    return;
}
```

Windows' tray menu opens directly, in the position the user expects Bloom's
menu to be. Those menus routinely carry destructive items — OpenKey's has
"Thoát" (Exit) — and the user reaches for a familiar slot without reading.

Note the `!e.shiftKey`: the author knew the hijack was hostile and shipped a
hidden escape hatch for it. That is a tell. A behaviour that needs
Shift to escape was understood to be wrong at the time it was written.

## What is actually wrong

Windows already has a system tray. A dock that duplicates tray icons into the
app row is not adding a capability, it is adding a second, ambiguous place for
the same thing.

The alternative the upstream change sidestepped: give Bloom its own tray area,
next to the dock extras, and keep tray icons there where users already expect
them. Then the dock row means "windows", unambiguously, and no setting is
needed.

That is the actual fix. It is a larger feature, not a settings change.

## What has been done meanwhile

`bloom-dock-show-tray-apps`, default `"false"`. Settings → Dock → "Tray Apps in
Dock". When off, `Dock.tsx` skips the merge and shows only real windows, which
is what the Windows taskbar does.

`selectDockTrayApps` still runs when the setting is off, so the observed set
stays current and turning it back on shows what is running immediately rather
than waiting for a window to open.

## Why it defaults to off

Upstream's behaviour is on, so defaulting off is a visible divergence and any
existing user loses their tray apps from the dock on upgrade.

The footgun still wins. With it on, a tray app in the dock answers a right
click with Windows' tray menu, whose entries include Quit, so a stray click
quits the app. That cost lands on everyone who does not find the setting, and
nobody goes looking for a toggle they do not know exists. Defaulting off means
the dock does what the taskbar it replaced does, and turning it on is one click
in Settings for anyone who wants upstream's layout.

The cost is bounded: `selectDockTrayApps` keeps running either way, so
switching it back on shows what is already running.

## Divergence from upstream

This setting is a fork-only divergence. If upstream revisits #168, this is the
place to argue with them — and the case is the footgun above, not the layout
preference.

## Code map

| What | Where |
|---|---|
| Window enumeration and its filters | `src-tauri/src/services.rs:3501` (`enum_windows_proc`) |
| Tray enumeration | `src-tauri/src/tray.rs`, `get_tray_apps` in `commands.rs:4155` |
| Tray eligibility | `src/dockApps.ts:32` (`selectDockTrayApps`) |
| The merge that adds the icon | `src/dockApps.ts:54` (`mergeTrayApps`) |
| Left click forwarding | `src/Dock.tsx:649` |
| Right click hijack | `src/Dock.tsx:713` |
| The setting | `Dock.tsx`, `settings/useSettings.ts`, `settings/DockTab.tsx`, `SETTINGS.md` |
