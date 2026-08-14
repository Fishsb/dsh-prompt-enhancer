# dsh-prompt-enhancer

One-click prompt optimizer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). Select any draft, click ✨, and an independent LLM call rewrites it into a stronger prompt — directly in the composer, with undo.

A dynamic Cordis plugin (`enh-1`) with host + client halves. MIT licensed.

## Features

- ✨ **One-click optimize** — independent LLM call, replaces the draft, fully undoable (editing the result exits undo).
- 🛡 **Slash-command guard** — `/compact 内容` optimizes only the body and keeps the `/cmd` prefix; a bare `/cmd` is disabled.
- 🧠 **Reasoning control** — per-model thinking on/off + native reasoning level (e.g. Off / High / Max).
- 🔗 **Configurable fallback chain** — ordered models tried after the main one; each entry has its own thinking setting; reorder / delete / restore defaults.
- ➕ **Custom models** — add model IDs under existing provider routes; a connectivity test runs on add.
- 🔁 **Load order** — reorder the catalog (directory + custom) for dropdown/candidate display.
- 🧪 **Connectivity test** — per-model reachability check with latency.
- 🎛 **Settings via DSH "Models & plugins" page** — model config / optimization params / plugin management in one entry.
- 🌍 **i18n** — follows the DSH interface language (中文 / English).
- 🔒 **Zero third-party dependencies** — plain JS host/client halves, no lockfile, minimal attack surface.

## Install & Run

This is a dynamic Cordis plugin. From the DSH GUI / the `end of conversation` tool lane:

1. **Define** the plugin with both host + client halves from the source:
   - Host half: `plugin-host.js`
   - Client half: `plugin-client.js`
   - Define with `cordis_define` (both halves must be present).
2. **Run** the current package with `cordis_run` (mode `run` / `update`). The first authorized client run is the activation.
3. Once authorized, the ✨ button appears in the composer's tool row, and the **"Models & plugins"** entry appears in **Settings**.

> **Browser note:** DSH dynamic-plugin client halves attach to the *active* page. After a page refresh the frontend can disappear; re-run the plugin (Settings → Models & plugins → Plugins → Run) to restore it. Your configuration persists in localStorage and is unaffected.

## Usage

| | |
|---|---|
| Default / idle | ✨ icon (disabled when guard fails; hover shows why) |
| Optimizing | spinner + "Optimizing" (click to cancel & restore original) |
| Optimized | "✓ Optimized · Undo" (click to restore original) |

- **Optimize**: type non-empty, non-slash text → click ✨ (or keep focus and press Enter).
- **Undo**: click the "✓ Optimized · Undo" button.
- **Cancel**: click while "Optimizing" — input restored, no error.
- **Edit-invalidates**: any manual edit after optimization exits undo.

### Configuration (Settings → Models & plugins)

| Tab | What |
|---|---|
| Models | Main model (provider/model + reasoning on/off + level + connectivity test), fallback chain (add/remove/reorder/per-entry thinking/restore defaults), custom models (add + auto connectivity test), load order |
| Optimization | Timeout, max output tokens, max output chars, template (built-in vs custom, ≤4000 chars) |
| Plugins | DSH dynamic-plugin inventory: status / version / run / stop / remove / approvals + **diagnostics log** viewer |

Configuration is stored in browser `localStorage` (`dsh.enhance.config.v2`; v1 auto-migrates). On first install the fallback chain inherits the currently used model (with its reasoning level). Invalid/missing config falls back to built-in defaults (host re-validates, never trusts client values).

### Defaults

- Main model: first available provider's first model (falls back to the built-in chain).
- Timeout 30s · output 2000 tokens · 8000 chars (all adjustable in Settings).
- Fallback: the built-in chain is **hardcoded to DeepSeek official models** (`deepseek-official/deepseek-v4-flash` → `deepseek-v4-pro`), used when no fallback is configured. The user-configurable fallback chain (Settings → Models & plugins) overrides it when set.

## Privacy & data flow

See [PRIVACY.md](PRIVACY.md) and [NOTICE](NOTICE). In short: the plugin sends only the template + your draft text to the configured LLM provider; it logs no prompt content and phones nothing home.

## Compatibility

- Requires a DSH build that injects the Cordis dynamic-plugin services used here (`llm`, `slots`, `locale`, `timer`, `agents`, `agentDefaultModel`, `dynamicCordisRunner`). DSH APIs are pre-release and may change; see the compatibility note in README.
- OS: anywhere DSH runs (Windows / macOS / Linux — the plugin itself is browser + Node).

## Security / reporting

- The plugin itself never runs shell commands or executes user code; prompt-injection risk is limited to normal LLM usage (result is written back to the draft only).
- Report issues via the repository's issue tracker following standard practice.

## License

MIT — see [LICENSE](LICENSE). The feature interaction pattern references a conventional prompt-engineering workflow (see NOTICE); all code and template text are original.

## Versioning

- **Release version** (this repository): `v1.0.0` — a standalone, user-facing version number for published releases. It is independent from the plugin's internal development version.
- **Development version** (internal): `v20` — tracks feature iterations inside the source (`v20: built-in fallback chain hardcoded to DeepSeek official models`).
- Mapping: release `v1.0.0` ⇄ development `v20`. Future releases increment the release number (`v1.1.0`, `v2.0.0`, …) regardless of internal dev versions.

### Changelog

| Release | Dev | Changes |
|---|---|---|
| v1.0.0 | v20 | Built-in fallback chain hardcoded to DeepSeek official models (`deepseek-official`); config v2 (main model / fallback chain / custom models / load order / params / template); reasoning on/off + native levels; connectivity test; slash-command guard; "Models & plugins" single settings entry; adaptive default chain removed in favor of fixed DeepSeek fallback.
