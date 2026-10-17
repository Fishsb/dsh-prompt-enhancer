# dsh-prompt-enhancer

A DeepSeek Harness (DSH) plugin: turn a composer draft into a clear, actionable prompt in one click — and add a hotkey plus stop-on-silence to voice input.

A draft is often half a requirement, so the model asks again — click ✨ and it is rewritten in place, undoable. With voice, just speak; it stops on a pause and the transcript lands back in the composer.

[![Release](https://img.shields.io/github/v/release/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/releases) [![Stars](https://img.shields.io/github/stars/Fishsb/dsh-prompt-enhancer)](https://github.com/Fishsb/dsh-prompt-enhancer/stargazers)

## Install

```sh
dsh plugin --profile web add github:Fishsb/dsh-prompt-enhancer#v3.4.2
dsh plugin --profile web update dsh-prompt-enhancer   # update
dsh plugin --profile web remove dsh-prompt-enhancer   # remove
```

Restart DSH afterwards (also after updating or removing) — the ✨ button appears in the composer toolbar. Requires [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installed locally and `pnpm` in PATH.

## What it does

**Prompt enhancement**

- ✨ **One-click enhance** — rewrite the current draft; keep refining, undo, or cancel while enhancing
- **5 modes** — Basic / Lite / Standard / Expert / One-click Publish
- **Memory switch** — pre-send rounds accumulate into a memory chain, cleared on send (off by default)
- **Model chain** — try models in order, add/remove/reorder, toggle thinking, test connectivity inline

**Voice input** (transcription is provided by DSH's official `speechToText`; the plugin ships no engine and downloads no models)

- **Two entry points** — the official 🎤 button, or the plugin hotkey (tap to start / tap to stop; long-press = hold to talk, release to stop)
- **Stop on silence** — auto-stop with a configurable 1-5 s silence window (default 2 s), can be turned off entirely
- **Filler removal** — local rule-based cleanup of filler words / repeats / drawn-out sounds; no rewriting, no additions (on by default)
- **Transcript correction** — word-level fixes after transcription, voice path only (off by default)
- **Auto-enhance** — trigger enhancement automatically once the transcript is in the draft (off by default)

Buttons and text follow the DSH interface language (中文 / English).

## Settings at a glance

Settings → "Prompt Enhancer"; changes save immediately:

| Where | What |
|---|---|
| Model chain | Model chain; Voice input: hotkey, stop-on-silence (1-5 s), filler removal, transcript correction, auto-enhance |
| Optimization | Mode, template, memory switch, context budget, timeout / reply length / output limit |

Capture, transcription and writing back are all handled by DSH's official voice control — the plugin only adds the value-adds above. Audio is not written to disk.

![Voice input](docs/screenshots/voice-main.png)

[Releases](https://github.com/Fishsb/dsh-prompt-enhancer/releases) · [CHANGELOG](CHANGELOG.md) · [Compatibility notes](docs/compatibility-matrix.md)

> Privacy: the plugin records and reports nothing; enhanced results come from an external LLM — verify before sending.
