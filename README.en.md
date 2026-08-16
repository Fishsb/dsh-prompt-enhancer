# dsh-prompt-enhancer

A prompt-enhancement plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): type a rough prompt, click ✨, and an independent LLM call rewrites it into a stronger prompt — directly in the composer, fully undoable.

[![Release](https://img.shields.io/github/v/release/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![Release date](https://img.shields.io/github/release-date/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases)
[![License](https://img.shields.io/github/license/Fishsb/dsh-prompt-enhancer)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer)

## Features

- ✨ **One-click enhance** — an independent LLM call replaces the draft in place; edit the result and the button becomes a plain **Continue** for further refinement; **undo anytime** (also drops the last memory round), **true cancel** while enhancing
- 🛡️ **Guards** — empty input / slash commands / submitting states are handled; `/cmd body` optimizes only the body, keeping the prefix
- 🎛️ **5 optimization modes** — Basic (direct, fastest) / Lite (local rules) / Standard (rules + workspace & session retrieval) / Expert (LLM task-progress analysis + full retrieval) / **One-click Publish** (rough idea → complete dev-spec generator prompt with clear boundaries: 9-chapter structure, LLM-planned multi-step web retrieval, auto scenario routing (game/software), self-review verdict; retrieved points remembered across rounds, iterative refinement)
- 🧠 **Independent memory switch** — when on, iterative rounds (optimize → edit → re-optimize) accumulate into a memory chain (**persistent memory**: fixed window of the latest 4 pairs, rolling; sending or clearing the composer does not clear it, Undo drops only the last round); each re-optimization replays the chain as a multi-turn conversation and senses your edit direction; when off, nothing is read or written
- 🌐 **i18n** — follows the DSH interface language (中文 / English)

## Screenshots

![Settings panel](docs/screenshots/settings-v2.4.3.png)

## Install

### Option 1: bundle one-click install (recommended)

```sh
dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer
```

Restart DSH (`dsh web`) after installing — the ✨ button appears in the composer toolbar. Update / remove:

```sh
dsh plugin --profile web update dsh-prompt-enhancer
dsh plugin --profile web remove dsh-prompt-enhancer
```

> After `remove`, **restart DSH** (`dsh web`) to unload the running instance — `remove` only cleans the installed files (package.json / node_modules / layer list); the host half lives in the service process and the client half in the page until the restart. A repeated `remove` reporting `no such dependency found` means the plugin is already uninstalled.
> Tag-locked installs (`github:...#v3.1.0`) do not upgrade via `update` — upgrade with `dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#<new-tag>`.
> Uninstalling does not clear the browser-side plugin config (`localStorage dsh.enhance.config.v2`); it persists across reinstall.

### Option 2: dynamic Cordis install

In a DSH session, ask the agent to read `plugin-host.js` (host half) and `plugin-client.js` (client half) from this repo, define the plugin with `cordis_define` (`plugin.kind: 'new'`), then `cordis_run` (mode: `run`). The first client-half run requires browser approval.

> Note: the dynamic client half is attached to the page connection active at activation time; a page refresh unloads it — just `cordis_run` again to restore.

### Quick-install snippet (paste into any DSH session)

```
Install the dsh-prompt-enhancer plugin for me:
1. Read plugin-host.js and plugin-client.js from https://github.com/Fishsb/dsh-prompt-enhancer
2. Define it with cordis_define: code.host = plugin-host.js, code.client = plugin-client.js, plugin.kind = new
3. cordis_run the returned pluginId/packageId (mode: run)
4. Wait for me to approve in the browser
```

## Usage

1. Type any non-empty text (slash commands keep their prefix; only the body is optimized)
2. Click the **✨** button
3. Wait for the independent LLM call; the draft is replaced with the enhanced version
4. Not satisfied? Click **✓ Optimized · Undo** to restore the original

## Configuration

Settings → "Models & plugins" → "Optimization" tab:

| Setting | Description |
|---|---|
| Optimization mode | Basic (default, direct) / Lite / Standard / Expert; switching takes effect immediately and persists |
| Memory | On / Off; when on, pre-send iterations accumulate into a memory chain (up to the latest 4 input/output pairs, injected as a multi-turn conversation with edit-direction sensing; first run falls back to Lite); when off, nothing is read or written |
| Context budget | 0 / 2000 / 4000 / 8000 chars; 0 = no context injection (the memory chain is budget-constrained too, chain cap 2400 chars) |
| Timeout / Max tokens / Output limit | Request parameters |
| Template | 3 built-in templates per mode: default (existing) / incremental supplement / incremental refine (dev-oriented, technical terms & code nouns); **multiple custom templates** per mode (≤10, ≤4000 chars each, name/edit/delete) |

The model chain lives in the "Models" tab: tried in order, reorderable, per-entry thinking toggle & level, inline connectivity test, restore defaults.

## Changelog

Per-version release notes live on [GitHub Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases); the full history is in [CHANGELOG.md](CHANGELOG.md).

## Privacy

- **Mode context**: on demand, injects "recent session messages + relevant workspace file snippets + related session fragments", bounded by the budget; sensitive files (.env / keys / credentials / logs, etc.) are hard-filtered and never injected
- **Memory**: only a boolean seen-marker lives in browser localStorage (no content); the memory chain (round inputs/outputs and edit deltas) lives only in the current page's memory and is sent to the chosen model provider with the optimization request; turning the switch off stops all reads/writes
- The plugin itself records or reports nothing; diagnostics logs contain only metadata (mode, latency, etc.)
- Enhanced results come from an external LLM — verify before sending; after cancellation the underlying request may still run briefly on the provider side

## Compatibility

- Depends on DSH runtime-injected APIs (`llm` / `slots` / `harness` / `inputActions` / `sessionQuery` / `fs`), which may change across DSH releases
- **Version check & one-click update**: the browser talks to `api.github.com` directly (CORS-enabled; the host needs no outbound network). Restricted networks must let the browser reach GitHub (proxy etc.)
- **Update & restart (v2.5.0+)**: requires the service to run under nssm/LocalSystem (default `dsh-web`; overridable via `updater.serviceName` / `updater.profile`). The install command auto-injects the user PATH (incl. pnpm); for GitHub pulls behind a proxy, configure `~/.npmrc` (same as manual install). Dynamic Cordis installs do not support this feature — use the bundle install
- **Built-in fallback model chain**: points at the official DeepSeek provider (`deepseek-official`); using it requires a DeepSeek API key. Without one, configure a model chain under "Models & plugins" — a fresh install inherits the current model automatically, so manual setup is usually unnecessary
- Use a recent DeepSeek Harness

## License

[MIT](LICENSE)
