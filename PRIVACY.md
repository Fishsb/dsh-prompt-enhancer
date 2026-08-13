# PRIVACY.md

This document describes what the `dsh-prompt-enhancer` plugin does with your data. Keep it in mind before using the plugin with any particular LLM provider.

## What is sent to the LLM provider

- The **optimization template** — a fixed system prompt (built-in) or your **custom template** if you configure one in Settings.
- The **draft text** you are optimizing (wrapped by the plugin in a quote block).
- Nothing else: no session history, no workspace files, no user profile/画像, no attachments, no sessionId.

This is a **zero context-injection** design (see `增强模板.md`): only "template + draft" crosses the wire.

## Data flow boundary

- Both your draft and the optimized result are transmitted to the LLM provider you (and DSH) have configured. They **leave your machine** and are processed by that third-party provider — subject to that provider's own terms and privacy policy.
- The plugin itself:
  - does **not** record or log prompt content (host logs are meta-only: model, timeout, effort, chain order, success/failure codes);
  - does **not** report telemetry to the plugin authors;
  - does **not** add any analytics or tracking;
  - stores **configuration** (not your drafts) in browser **localStorage** on your machine.
- Because the LLM channel may be async, a cancelled optimization may still have already been sent to the provider — cancellation discards the result locally but cannot guarantee the remote side did not receive/process the text.

## Configuration storage

- Your model selection, fallback chain, custom models, load order, parameters, and custom template are stored in your browser's `localStorage` (`dsh.enhance.config.v2`), which is local to that browser instance and not shared across browsers/machines.
- Clear your site data to remove it.

## Recommended practice

- Review the privacy policy of whichever LLM provider your DSH configuration routes to.
- The raw result of an optimization is text synthesized by an external LLM — verify it before sending, and do not paste confidential/institutional data into the draft if your provider's policy does not permit it.

Last updated: 2026-08
