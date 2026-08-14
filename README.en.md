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

Dynamic Cordis plugin (host + client halves):

1. Place `plugin-host.js` and `plugin-client.js` where the DSH session can reach them
2. Define and run the plugin in a DSH session (both halves must be registered)
3. After the first authorized run, the ✨ button appears in the composer tool row

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
