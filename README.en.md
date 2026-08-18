# dsh-prompt-enhancer

A DeepSeek Harness (DSH) plugin with two core capabilities: **prompt enhancement** (rewrite composer drafts in place with ✨, fully undoable) and **one-click restart for DSH service failures** (recover from the CLI even when the web UI is down).

[![Release](https://img.shields.io/github/v/release/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![Release date](https://img.shields.io/github/release-date/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![Stars](https://img.shields.io/github/stars/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer)

## ✨ Highlights

- **✨ One-click enhance** — the ✨ button triggers an independent LLM call and replaces the draft in place; continue refining, undo anytime, or cancel while enhancing
- **📋 5 optimization modes** — Basic (direct) / Lite (previous-round context) / Standard (rules + retrieval) / Expert (task analysis + full retrieval) / One-click Publish (complete dev-spec generator)
- **🧠 Memory switch** — when on, pre-send rounds (optimize → edit → re-optimize) accumulate into a memory chain the next round replays and senses your edit direction; sending the message clears it; when off, nothing is read or written
- **🔗 Model chain** — try multiple models in order, reorder, toggle thinking, run inline connectivity tests
- **🔁 One-click restart (standalone feature)** — restart DSH even when the web UI is down: double-click the desktop shortcut (whale icon) or invoke the CLI directly; supports service-managed (Windows/Linux/macOS) and process-level fallback restart
- **🌐 i18n** — follows the DSH interface language (中文 / English)

## 🚀 Install

```sh
dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#v3.2.0
```

Restart DSH (`dsh web`) after installing — the ✨ button appears in the composer toolbar.

> Requires [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installed locally and `pnpm` in PATH.

Update / remove:

```sh
dsh plugin --profile web update dsh-prompt-enhancer
dsh plugin --profile web remove dsh-prompt-enhancer
```

> After `remove`, restart DSH to fully unload the running instance.

## 🔁 One-click restart (standalone feature)

Restart DSH even when the service is broken and the web UI is unreachable — no browser, no 3080 port required. In plugin settings, click "**Desktop**" on the "Restart port" confirmation to create a whale-icon "Restart DSH" shortcut; double-click it to restart with live progress. No shortcut needed either — run from any command window:

```sh
node "<DSH_HOME>\AppData\Local\dsh-prompt-enhancer\executor\0.1.11\lib\updater-host.cjs" --cli restart --service dsh-web --profile web
```

Supports service-managed restart on Windows (sc) / Linux (systemctl) / macOS (launchctl) with process-level fallback.

## 📦 Library notes

Core logic lives in standalone Node modules, reusable from other scripts: `lib/shortcut-win.cjs` (Windows shortcut generation), `lib/updater-host.cjs` (CLI restart / update executor), `lib/platform-service.cjs` (cross-platform service management), `lib/sys.cjs` (env & paths). See each module's header comments.

## 🎯 Usage

1. Type any non-empty text (slash commands keep their prefix; only the body is optimized)
2. Click the **✨** button
3. Wait for the independent LLM call; the draft is replaced with the enhanced version
4. Not satisfied? Click **Undo** to restore the original

## 📸 See it work

**Model configuration** (try multiple models in order):

![Model configuration](docs/screenshots/settings-models.png)

**One-click restart CLI** (recover from the CLI when the service is down):

![One-click restart CLI](docs/screenshots/restart-cli.png)

## ⚙️ Configuration

Settings → "Models & plugins":

| Tab | Description |
|---|---|
| **Model configuration** | Configure the optimization model chain: tried in order, reorderable |
| **Optimization parameters** | Mode / memory switch / context budget / timeout & output limits / templates |

## 📚 Docs

- [Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
- [CHANGELOG](CHANGELOG.md)
- [Compatibility notes](docs/compatibility-matrix.md)

> Privacy: the plugin records or reports nothing; enhanced results come from an external LLM — verify before sending.
