# Codex Frosted Glass

A **frosted-glass skin for the [Codex](https://openai.com/codex/) desktop app** (Windows / Electron) with adjustable transparency and blur.

No binary patching, no broken signatures, fully reversible — all styling is injected at runtime, and removing a single class restores the stock look.

> Third-party project, not affiliated with OpenAI. It only changes the local visual layer — no account, network, or data involvement.

**English** · [简体中文](README.md)

![Main window](docs/preview-main.png)

<p align="center">
  <img src="docs/preview-transparent.png" width="49%" alt="High transparency" />
  <img src="docs/icon-preview.png" width="49%" alt="Icon" />
</p>

---

## Features

- **Real frosted glass** — `backdrop-filter: blur() saturate()` on the app shell, blurred live rather than faked with a translucent image
- **Live-adjustable** — drag a slider, the whole UI updates instantly, no reload
- **Layered depth** — shell, composer, and sidebar use three different glass thicknesses
- **Zero background processes** — double-click, launch + inject, exit. Nothing idles afterwards
- **Reversible** — toggle the `◐` button (or the `cf-off` class on `<html>`) to switch back to stock
- **Non-invasive** — no registry writes, no autostart, no services, no telemetry

## How it works

```mermaid
flowchart LR
    A["Codex-skinned.cmd"] -->|"--remote-debugging-port=9335"| B["Codex main process"]
    B --> C["Renderer<br/>Chromium"]
    A --> D["inject.js"]
    D -->|"HTTP /json/list"| C
    D -->|"WebSocket Runtime.evaluate"| C
    C --> E["payload.js runs"]
    E --> F["skin.css injected"]
    E --> G["Ambience layers #cf-backdrop + #cf-grain"]
    E --> H["Control panel + geometric tagging"]
```

Chromium only exposes a debugging endpoint when launched with `--remote-debugging-port`. That is the one way into the renderer without touching the installed package. The injector exits once done — the skin keeps itself alive through an in-page `MutationObserver`, so no daemon is needed.

### Why not true desktop transparency

The intuitive expectation is "blur my wallpaper behind the window". That is not possible on Windows 10:

- Codex relies on Electron's `backgroundMaterial: "mica"`, and **Mica is Windows 11 only**. On Windows 10 the system ignores it and the app silently falls back to an opaque window (`html.electron-opaque`)
- I tested Windows 10's DWM acrylic (`SetWindowCompositionAttribute` — the call even reports success): **the blur does not penetrate an opaque Electron window**, the surface stays flat
- The only real fix is repacking `app.asar` to change the window flags, which breaks MSIX signing and auto-update — not worth it

So this project takes the other route: **draw an ambience gradient inside the app as the "thing behind the glass", then blur that for real.** Visually identical to frosted glass, and completely reversible.

## Requirements

| Item | Requirement |
|---|---|
| OS | Windows 10 / 11 x64 |
| Client | Codex desktop app (MSIX-packaged Electron, entry `ChatGPT.exe`) |
| Runtime | Node.js ≥ 18 (no npm dependencies) |
| Port | local `9335` (override with the `CDP_PORT` env var) |

## Quick start

**Option A — download the release** (no git needed): grab `codex-frosted-glass-v1.7.0.zip` from
[Releases](https://github.com/ISkywalkerI/codex-frosted-glass/releases/latest), extract it to a **permanent folder**, and double-click `Codex-skinned.cmd`.

**Option B — clone**:

```bat
git clone https://github.com/ISkywalkerI/codex-frosted-glass.git
```

Do not leave the folder in a temp directory — the launcher resolves `inject.js` relative to its own location.

The launcher adapts to the current state:

| State | Behaviour |
|---|---|
| Codex not running | Launches with the debug port → waits for the UI → injects → exits (~8–12 s) |
| Skinned instance already running | Re-injects immediately, exits within a second |
| Stock instance running (no port) | Asks whether to restart it; Enter to take over |
| A long-running instance | Leaves it alone, tells you what to do |

To get the **stock client**, just use Codex's own icon as usual. The two do not interfere.

### CLI

```bash
node inject.js --open      # ensure skinned launch + inject once, then exit (recommended)
node inject.js --once      # inject into the running instance only
node inject.js --restart   # force restart, then inject
node inject.js             # daemon mode: re-inject on reload/restart (stays resident)
```

## Usage

A control panel appears in the bottom-right corner:

| Action | Effect |
|---|---|
| Drag **Transparency** | 0% fully opaque → 100% almost fully transparent |
| Drag **Blur** | 0–60 px |
| Drag the title bar | Move the panel (position is remembered) |
| `◐` | Toggle the skin (turning it off restores the stock look instantly) |
| `–` | Collapse / expand the panel |
| `Ctrl + Shift + G` | Hide / show the panel (handy for screenshots) |

Settings live in `localStorage["cf-glass-v1"]`; defaults are `transparency 55% / blur 26px`.

## Implementation notes

### 1. Making design tokens translucent

Codex's UI is almost entirely driven by CSS variables, so instead of walking the DOM, the "solid surface" tokens are rewritten as alpha-blended colours:

```css
--color-token-main-surface-primary:
  color-mix(in srgb, #011627 calc(var(--cf-alpha) * 100%), transparent);
```

One change and every panel referencing those tokens becomes translucent. Over 20 tokens are handled (`--color-surface*`, `--app-color-background-*`, `--app-shell-*`, …).

### 2. Three thicknesses

| Layer | Treatment |
|---|---|
| Shell `#root` | `blur(var(--cf-blur)) saturate(1.65)` — one sheet of glass across the window |
| Composer | `alpha × 1.18` + `blur × 1.15` + 1px top inner highlight (reads as raised glass) |
| Sidebar | `blur × 0.7` + `saturate 1.3` + 1px right edge highlight (thinner, more transparent) |

### 3. Geometric tagging instead of class names

Codex uses hashed class names (`ComposerLayoutBody-uBBf1A`) that change on every release, so elements are located by shape:

- **Composer**: climb up to 7 levels from `textarea` / `contenteditable`, take the first ancestor with `radius ≥ 8px, width ≥ 220, height ≥ 36`
- **Sidebar**: inside `#root`, find the element with `left ≤ 4px, height ≥ 82% viewport, width between 180 and min(520, 42% viewport)`

### 4. The maths

```js
alpha = 1 - (t / 100) * 0.94      // t=0 → 1.0 (opaque), t=100 → 0.06
--cf-blur = Npx
```

Every `color-mix` and `blur()` references those two variables, so changing them forces a single style recalculation — which is why dragging feels instant.

## Cost

Measured across all 22 Codex processes over a 20-second window:

| State | CPU (one core) | Notes |
|---|---|---|
| Skin off | 0.16% | baseline |
| Skin on | 0.16% | **identical** — no repaint, no recompute while idle |
| Injector | a few seconds after double-click | exits when done; 0% otherwise |

The real cost appears while **scrolling, dragging the window, or streaming tokens**, where every frame re-blurs the backdrop. `blur(38px)` is on the heavy side; if you notice dropped frames, lowering it to 15–20px is the most effective change and looks nearly the same.

## Known limitations

- **Reloading the page drops the skin.** Styles live in the current page, so a refresh or reopen loses them — double-click the entry again. Use daemon mode (`node inject.js`) to keep it alive automatically (about 57 MB resident)
- **The app must be launched with the debug port** for injection to work; opening it from the Start menu normally will not apply the skin (that is how Chromium works)
- No desktop transparency on Windows 10 — see above
- A major UI redesign may break the geometric tagging. The log then shows `composer× sidebar×`, and the thresholds in `payload.js` need a tweak

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Closes instantly, or `MODULE_NOT_FOUND` | Script was moved. `cd` into the folder containing `inject.js`, or set `CF_HOME` |
| `cannot connect to Codex debug port` | Codex has been running the stock way for a while. Quit it fully and retry, or run `node inject.js --restart` |
| Injection succeeds but nothing changes | Panel may be hidden — press `Ctrl+Shift+G`; or the skin is toggled off — click `◐` |
| Text becomes unreadable | Transparency is too high; bring the slider back to 40–60% |
| Broke after a Codex update | Class names or tokens changed; check the console log |

## Layout

```
codex-frosted-glass/
├─ Codex-skinned.cmd     # one-click entry
├─ inject.js             # launcher + CDP injector
├─ payload.js            # runs in the renderer: style, panel, tagging
├─ skin.css              # all glass styling (with tunable variables)
├─ cdp.js                # minimal CDP client (debugging)
├─ capture.js            # in-renderer screenshot (ignores window occlusion)
├─ codex-skinned.ico     # gradient icon, 16–256 px
└─ docs/                 # preview images
```

## Uninstall

1. Quit Codex
2. Delete this folder
3. Injected styles vanish with the process; the client is back to stock

Nothing is written to the registry, no autostart entry, no service. To verify: `dir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"` should contain nothing from this project.

## License & notices

Code released under the [MIT License](LICENSE).

- **Codex and ChatGPT are trademarks of OpenAI.** The white mark in `codex-skinned.ico` is taken from the tile assets of the locally installed client and is used solely to identify the app it launches; all trademark rights remain with OpenAI. The file can be deleted on request from the rights holder, and the icon can be replaced.
- This project contains and distributes no OpenAI program code; it only reads the renderer of the locally installed app at runtime.
- Use at your own risk.
