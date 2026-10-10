<div align="center">

<img 
  src="https://github.com/user-attachments/assets/962887ec-636b-4e0f-90eb-0862c0feefca" 
  width="72"
/>

# Bloom

<br/>

<!-- HERO SHOWCASE — full-width cinematic shot or video -->
<!-- ![Hero](your-hero-url) -->
<img width="1920" height="1080" alt="Bloom Hero" src="https://github.com/user-attachments/assets/22041f25-a69e-457d-80d9-7dfbfbed2d29" />

<video width="1920" height="1080" src="https://github.com/user-attachments/assets/fa7f949b-d9c3-4a92-b00d-e1132c0f3ff1">

</div>

---

Bloom makes your Windows desktop feel alive.

Every transition is a physics simulation.
Every element responds to touch.
Every pixel is in motion.

Your desktop has been asleep for years.
This wakes it up.

---

## The Island

<!-- SHOWCASE: GIF or short clip — Island expanding, cycling through modes (3-5s) -->
<!-- ![Island Demo](your-island-gif-url) -->

<p align="center">
  <img width="430" height="70" alt="Bloom Island" src="https://github.com/user-attachments/assets/0d723558-9df4-4214-b20e-4a1f97eb1f22" />
</p>

A notch at the top of your screen that adapts to what you're doing.

Scroll or swipe to switch modes.
Watch it transform.

**Music** — album art, track info, playback controls. A visualizer that reacts to five frequency bands with spring physics. It moves when the music plays.

<!-- SHOWCASE: GIF — music mode reacting to a song -->
<!-- ![Music Visualizer](your-music-gif-url) -->

**Command Center** — WiFi, Bluetooth, Do Not Disturb, volume, brightness. Everything you usually dig through settings for.

<!-- SHOWCASE: GIF — command center toggling controls -->
<!-- ![Command Center](your-command-center-gif-url) -->

**Status** — Battery, weather. Your desktop, summarized.

**Calendar** — A month view with a Pomodoro timer. Focus without switching apps.

Each transition is spring-loaded.
Width, height, border-radius, position — all animate independently.
It feels mechanical. In a good way.

---

## The Dock

<!-- SHOWCASE: GIF — dock appearing on hover, drag-reorder, window previews -->
<!-- ![Dock Demo](your-dock-gif-url) -->

<p align="center">
  <img width="576" height="102" alt="Bloom Dock" src="https://github.com/user-attachments/assets/96229f0e-1246-4baf-b8ad-3e8f77142a12" />
</p>

A taskbar that actually moves.

Bloom replaces your native Windows taskbar.
It sits at the bottom of your screen, always there when you need it.

Drag to reorder.
Hover for window previews.
Right-click for context menus.

It's not an overlay.
It _is_ your taskbar.

<!-- SHOWCASE: GIF — dock hover previews in action -->
<!-- ![Window Previews](your-preview-gif-url) -->

---

## Under the Hood

<!-- SHOWCASE: Optional — architecture diagram or visual of the 5-window system -->
<!-- ![Architecture](your-arch-url) -->

A Rust backend that speaks directly to the Windows shell.

Global hooks intercepting keys before Windows sees them.
WASAPI capturing system audio in real-time.
COM controlling your media sessions.
WMI monitoring your hardware.

The whole thing sleeps when you don't need it.
The audio visualizer pauses when nothing's playing.
The cursor monitor hides when the dock is gone.
Thumbnails only refresh on focus.

It's fast because it has to be.

---

<!-- SHOWCASE: Full-width cinematic video or GIF montage -->
<!-- ![Bloom Montage](your-montage-url) -->

---

## 🛡️ Microsoft Defender

Some users may see a Microsoft Defender warning when installing Bloom.

The executable was submitted directly to Microsoft for analysis. Microsoft reviewed the file and confirmed that it **does not meet their criteria for malware or potentially unwanted applications**, and **the detection has been removed**.

<p align="center">
  <img width="800" alt="Microsoft Security Intelligence" src="https://github.com/user-attachments/assets/67ddddde-9c68-4338-a0f2-c5645e416514" />
</p>

<details>
<summary>Still seeing the detection?</summary>

Your system may still have the previous Defender signature cached. Microsoft recommends updating your Defender security intelligence.

Open **Command Prompt as Administrator** and run:

```cmd
cd "C:\Program Files\Windows Defender"
MpCmdRun.exe -removedefinitions -dynamicsignatures
MpCmdRun.exe -SignatureUpdate
```

</details>

## Get It Running

**Download** the latest build from [Releases](https://github.com/SehajveerSingh2005/bloom/releases/latest).

Or build from source:

```bash
git clone https://github.com/SehajveerSingh2005/bloom.git
cd bloom
bun install
bun run tauri dev
```

You'll need [Rust](https://rustup.rs/) and [Bun](https://bun.sh/). That's it.

---

## If your taskbar is missing

Bloom hides the Windows taskbar on purpose — that's how it takes its place. If
Bloom is killed without a clean shutdown (Task Manager's **End task**, Explorer
crashing while a tray menu was open, or a power loss), the taskbar can stay
hidden after Bloom is gone.

1. **If Bloom is still running**, open **Settings → General** and turn **Dock**
   off (or use **Quit Bloom**). Turning the Dock off hands the taskbar back to
   Windows right away — left-clicking Bloom's tray icon opens Settings.
2. **Relaunch Bloom.** Press <kbd>Win</kbd>, type `bloom`, press
   <kbd>Enter</kbd>. Bloom leaves a small marker file
   (`taskbar_hidden.flag` in `%APPDATA%\com.sehaz.bloom\`) whenever it hides
   the taskbar, and the next launch reads that marker and hands the taskbar
   back before doing anything else.
3. **Restart Explorer.** First make sure Bloom is not running - while it is,
   it re-hides the taskbar within about a tenth of a second, so restarting
   Explorer will appear to do nothing. Close Bloom, then press
   <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Esc</kbd> to open Task Manager, pick
   **Windows Explorer**, and choose **Restart**. This works with no taskbar at
   all and rebuilds it from scratch.

If none of those work, restarting Windows clears it too.

### Why this can happen at all

Every normal exit path in Bloom — the tray menu, the in-app Quit button, the
window close handler, and the console close handler — restores the taskbar
before exiting. Turning the Dock off in Settings does the same. `End task` in
Task Manager sends `TerminateProcess`, which skips all cleanup code, so the
marker file is the only thing that survives.

While Bloom is running it keeps re-hiding the taskbar on a ~150ms loop, so a
step above will look like it did nothing if Bloom is still alive. Close Bloom
first, then retry.

If you hit this, please [open an issue](https://github.com/carlylekatto/bloom/issues)
with your Bloom version, your Windows version, and how Bloom was killed. A taskbar
that won't come back means something broke in a path we didn't cover.

---

## Contributing

Bloom is open source.
Found a bug? Open an issue.
Have an idea? Open a feature request first — we'll agree on the approach before you write code. See [CONTRIBUTING.md](CONTRIBUTING.md).
Want to just say it's cool? A star goes a long way.

Licensed under [GPLv3](LICENSE).

---

<div align="center">

**Your desktop is waiting.**

</div>
