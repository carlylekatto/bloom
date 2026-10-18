# Tray apps in the dock — open design question

Status: **open, and narrower than it was**. The right-click problem described
below was fixed upstream (#234). What remains is the layout argument: the dock
row is visually ambiguous between windows and tray icons. Written down so the
next person does not rediscover it from a misclick.

## The symptom

An app that closes its window to the system tray — Cisco App, Unikey,
OpenKey, and others — keeps a lit icon in Bloom's dock. The user expects it to
leave, the way the Windows taskbar hides it behind the tray overflow. The icon
looks exactly like a running app's icon, so it invites the click that assumes it
is one.

## It is upstream behaviour, not a fork bug

Introduced by `5792ce3`, PR #168, "keep background tray apps in the dock and
add notch panel arrows", by Dhanush Santosh, 2026-10-09. That commit wrote both
halves of the original behaviour: keeping the icon, and hijacking right click.

## The window enumeration is not at fault

Checked first, because "the dock forgot to filter hidden windows" is the
obvious suspect and it is wrong here.

`src-tauri/src/services.rs` filters on `IsWindowVisible`, and also checks
`DWMWA_CLOAKED` for shell-cloaked and suspended windows. Both are correct.

Enumerating every top-level window of a closed-to-tray OpenKey64 on the
reporting machine:

```
hwnd=0x350066   vis=False   rect=(77,77)-(1229,777)  1152x700
hwnd=0x87002BE  vis=False   rect=0x0
hwnd=0x3C6CF6   vis=False   rect=0x0
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

## Left click still forwards to the app

`Dock.tsx:704`:

```tsx
} else if (app.is_background && app.tray_ids?.length === 1) {
    await invoke("activate_tray_icon", { trayId: app.tray_ids[0] });
}
```

This forwards whatever the tray icon does on a left click. For most apps that
is "restore the window", which is harmless and arguably what the user wanted.
For an app whose tray click does something else, the user has no idea they just
triggered it. Unchanged by #234.

## The right-click hijack — resolved upstream

Right click used to bypass Bloom's menu entirely for a single-icon tray app:

```tsx
if (app?.is_background && app.tray_ids?.length === 1 && !e.shiftKey) {
    void openTrayMenu(app.tray_ids[0]);
    return;
}
```

Windows' tray menu opened directly, in the position the user expected Bloom's
menu to be. Those menus routinely carry destructive items — OpenKey's has
"Thoát" (Exit) — and the user reaches for a familiar slot without reading. The
`!e.shiftKey` was a tell: the author shipped a hidden escape hatch for a
behaviour they understood to be hostile.

`2f46bc3`, PR #234, removed the branch. Right click now always opens Bloom's
menu, and the app's native tray menu is one click away under **App tray menu**
(`Dock.tsx:1865`) — the entry that already existed for apps with several tray
icons. Nothing was lost in the move; the destructive menu is simply no longer
where the user was not looking for it.

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

Originally the deciding argument was the footgun above: a stray right click
answered with a tray menu whose entries include Quit. That argument is gone,
and this default is now a layout preference rather than a safety one — the dock
row stays unambiguous, and it does what the taskbar it replaced does.

That is a weaker reason than the one the setting shipped with, and it is
recorded here as such. If upstream ever adds its own tray area, the case for
removing the setting is the layout one, and this default should probably follow
whatever they choose.

The cost is bounded: `selectDockTrayApps` keeps running either way, so
switching it back on shows what is already running.

## Divergence from upstream

This setting is a fork-only divergence. If upstream revisits #168, this is the
place to argue with them. Note that #234 already took the strongest half of
the argument — the destructive right click — off the table upstream, so the
remaining case is the layout one.

## Code map

| What | Where |
|---|---|
| Window enumeration and its filters | `src-tauri/src/services.rs` (`enum_windows_proc`) |
| Tray enumeration | `src-tauri/src/tray.rs`, `get_tray_apps` in `commands.rs` |
| Tray eligibility | `src/dockApps.ts:32` (`selectDockTrayApps`) |
| The merge that adds the icon | `src/dockApps.ts:54` (`mergeTrayApps`) |
| Left click forwarding | `src/Dock.tsx:704` |
| Right click, always Bloom's menu | `src/Dock.tsx:775` (`handleContextMenu`) |
| "App tray menu" entry | `src/Dock.tsx:1865` |
| The setting | `Dock.tsx`, `settings/useSettings.ts`, `settings/DockTab.tsx`, `SETTINGS.md` |