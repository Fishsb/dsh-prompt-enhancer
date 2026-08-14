# dsh-prompt-enhancer

A prompt-enhancement plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): type a rough prompt, click ✨, and an independent LLM call rewrites it into a stronger prompt — directly in the composer, fully undoable.

## Features

- ✨ **One-click enhance** — independent LLM call replaces the draft in place
- ↩️ **Undo anytime** — restore the original; manually editing the draft exits undo
- ⏹️ **True cancel** — click during enhancement aborts and restores the draft (AbortSignal propagated)
- 🛡️ **Guards** — empty input / slash commands / submitting states are handled; `/cmd body` optimizes only the body, keeping the prefix
- 🌐 **i18n** — follows the DSH interface language (中文 / English)
- 🔒 **Zero context injection** — only the template + input text are sent to the LLM; no session history, files, attachments, or profile

## Install

Dynamic Cordis plugin (host + client halves), installed inside a DSH session via the cordis toolchain:

1. Ask the DSH agent to read `plugin-host.js` (host half) and `plugin-client.js` (client half) from this repository
2. Define the plugin with `cordis_define`: `code.host` = full content of plugin-host.js, `code.client` = full content of plugin-client.js (`plugin.kind: 'new'`), which returns `pluginId` / `packageId`
3. Run it with `cordis_run` (mode: `run`)
4. The first client run requires browser approval
5. After authorization, the ✨ button appears in the composer tool row

> Note: the dynamic plugin's client half attaches to the page connection active at run time; it unloads on page refresh — re-run `cordis_run` to restore.

### Quick install (copy into any DSH session)

```
Install the dsh-prompt-enhancer plugin:
1. Read plugin-host.js and plugin-client.js from https://github.com/Fishsb/dsh-prompt-enhancer
2. Define the plugin with cordis_define: code.host = full plugin-host.js, code.client = full plugin-client.js, plugin.kind = new
3. cordis_run the returned pluginId/packageId (mode: run)
4. Wait for my browser approval, then it is installed
```

> A bundle distribution (`dsh.plugin` / `cordis.patch.yml` one-command install) is planned.

## Usage

1. Type any non-empty text that is not a bare slash command
2. Click **✨** (or press Enter while focused)
3. The draft is replaced by the enhanced version when the call completes
4. Not satisfied? Click **✓ enhanced, undo** to restore the original

## Configuration

Enhancement reuses DSH's configured LLM providers (read from DSH config; no duplicated keys).

Current version uses code constants — adjust at the top of `plugin-host.js`:

| Constant | Default | Description |
|---|---|---|
| `DEFAULT_CHAIN` | DeepSeek official model fallback chain | Main model + fallback chain (provider names must match your DSH config) |
| `DEFAULT_TIMEOUT_MS` | `30000` | Per-request timeout |
| `DEFAULT_MAX_TOKENS` | `2000` | Output token limit |
| `DEFAULT_OUTPUT_LIMIT` | `8000` | Output character limit |
| `SYSTEM_PROMPT` | Built-in template | Enhancement template |

## Privacy

- Only the fixed template + input text are sent to the configured LLM provider; **zero context injection**
- The plugin records and reports nothing; logs contain no prompt content
- Enhanced results come from an external LLM — review before sending
- After cancel, the underlying request may briefly keep running on the provider side

## Compatibility

- Depends on DSH runtime-injected APIs (`llm` / `slots` / `harness` / `inputActions`), subject to change with DSH releases
- Requires a recent DeepSeek Harness

## License

[MIT](LICENSE)
