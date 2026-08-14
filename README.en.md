# dsh-prompt-enhancer

A prompt-enhancement plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): type a rough prompt, click ✨, and an independent LLM call rewrites it into a stronger prompt — directly in the composer, fully undoable.

## Features

- ✨ **One-click enhance** — independent LLM call replaces the draft in place
- ↩️ **Undo anytime** — restore the original with one click; manually editing the draft exits undo (undo also clears the previous memory pair)
- ⏹️ **True cancel** — click during enhancement aborts and restores the draft (AbortSignal propagated)
- 🛡️ **Guards** — empty input / slash commands / submitting states are handled; `/cmd body` optimizes only the body, keeping the prefix
- 🌐 **i18n** — follows the DSH interface language (中文 / English)
- 🎛️ **4 modes (v2.2.0)** — Basic (direct, fastest) / Lite (local rule analysis) / Standard (rules + workspace & session retrieval injection) / Smart (LLM task-progress analysis + full retrieval)
- 🧠 **Independent memory switch (v2.2.0)** — available in every mode; when on, the previous optimization pair is injected into the next round (first run falls back to Lite automatically); when off, memory is never read or written; memory is written while on and cleared on undo
- 🔀 **Combined stacking** — mode context block + memory block can inject together (memory takes budget first, ≤1200 chars; the mode block uses the remainder)
- 🔄 **Automatic config migration** — v2.1 `mode:'memory'` / `autoMemory` migrate to `mode:'lite'` + `memory:true`; an explicit `memory` field takes precedence (including `false`)
- 🧪 **Unit-tested** — host pure-function tests (node:test, 30/30 passing) slice the PURE section, so tests run the very code that is shipped

## Install

### Option 1: bundle one-click install (recommended)

```sh
dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer
```

Restart DSH (`dsh web`) after installing — the ✨ button appears in the composer toolbar. Update with `dsh plugin --profile web update dsh-prompt-enhancer`, remove with `dsh plugin --profile web remove dsh-prompt-enhancer`.

### Option 2: dynamic Cordis install

Dynamic Cordis plugin (host + client halves), installed inside a DSH session via the cordis toolchain:

1. Ask the agent in a DSH session to read `plugin-host.js` (host half) and `plugin-client.js` (client half) from this repo
2. Define the plugin with `cordis_define`: fill `code.host` with plugin-host.js and `code.client` with plugin-client.js (new plugin: `plugin.kind: 'new'`); it returns `pluginId` / `packageId`
3. Run it with `cordis_run` (mode: `run`)
4. The first client-half run requires browser approval
5. After approval, the ✨ button appears in the composer toolbar

> Note: the dynamic client half is attached to the page connection active at activation time; a page refresh unloads it — just `cordis_run` again to restore.

### Quick-install snippet (paste into any DSH session)

```
Install the dsh-prompt-enhancer plugin for me:
1. Read plugin-host.js and plugin-client.js from https://github.com/Fishsb/dsh-prompt-enhancer
2. Define it with cordis_define: code.host = plugin-host.js, code.client = plugin-client.js, plugin.kind = new
3. cordis_run the returned pluginId/packageId (mode: run)
4. Wait for me to approve in the browser
```

> Bundle distribution (`dsh plugin add` one-click install) is supported — see Option 1 above.

## Usage

1. Type any non-empty, non-slash-command text
2. Click the **✨** button (or press Enter while focused)
3. Wait for the independent LLM call; the draft is replaced with the enhanced version
4. Not satisfied? Click **✓ Optimized · Undo** to restore the original

## Configuration

Settings → "Models & plugins" → "Optimization" tab:

| Setting | Description |
|---|---|
| Optimization mode | Basic (default, direct) / Lite / Standard / Smart; switching takes effect immediately and persists |
| Memory | On / Off; when on, the next round receives the previous optimization pair (first run falls back to Lite); when off, nothing is read or written |
| Context budget | 0 / 2000 / 4000 / 8000 chars; 0 = no context injection (equivalent to Basic); the memory block is budget-constrained too |
| Timeout / Max tokens / Output limit | Request parameters |
| Template | Built-in / custom template text |

The model chain lives in the "Models" tab: tried in order, reorderable, per-entry thinking toggle & level, inline connectivity test, restore defaults.

## Privacy

- **Mode context**: on demand, injects "recent session messages + relevant workspace file snippets + related session fragments", bounded by the budget; sensitive files (.env / keys / credentials / logs, etc.) are hard-filtered and never injected
- **Memory**: only a boolean seen-marker lives in browser localStorage (`dsh.enhance.seen.*`, no content); the memory pair itself lives only in the current page's memory; turning the switch off stops all reads/writes
- The plugin itself records or reports nothing; diagnostics logs contain only metadata (mode, latency, etc.)
- Enhanced results come from an external LLM — verify before sending; after cancellation the underlying request may still run briefly on the provider side

## Compatibility

- Depends on DSH runtime-injected APIs (`llm` / `slots` / `harness` / `inputActions` / `sessionQuery` / `fs`), which may change across DSH releases
- Use a recent DeepSeek Harness

## License

[MIT](LICENSE)
