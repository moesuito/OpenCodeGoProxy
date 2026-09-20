# OpenCodeGoProxy

> Full technical docs in [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

Local proxy to run **every OpenCode Go model** in **Codex (CLI + App)** and
**Claude Code**, with:

- **Multi-key**: several OpenCode Go API keys with round-robin + failover on 429/5xx. Clients only get **429 when ALL keys are exhausted** (upstream or local budget); `retry-after` forwarded.
- **Per-model sanitization**: drops recursive schemas (cyclic `$ref`, e.g. Gmail tools in Codex) and converts `custom` tools — the real cause of the `Recursive JSON schemas are not currently supported` error on Muse Spark.
- **Quota guards**: model allowlist, `maxOutputTokens`, reasoning-effort cap and estimated daily budget (USD) per key. Local estimates — the official console (`opencode.ai/auth`) is the source of truth.
- **Guided setup** for Codex and Claude Code + an **Electron app** living in the tray.

Related/inspiration (all open source): `lidge-jun/opencodex` (universal Codex/Claude proxy, MIT), `duolahypercho/codex-router` (router for Codex App+CLI), `routatic/proxy` (ex `oc-go-cc`, Claude Code ↔ Go/Zen), `xb0or/opencode-GO` (multi-key gateway), `Hiyajomaho-num9/opencode-go-codex` (Chat→Responses 2api for Codex). None combined schema sanitization + quota guards + Windows tray — hence this repo.

## How it works

```
Codex CLI/App --(Responses)--> http://127.0.0.1:11447/v1/responses --sanitize--> https://opencode.ai/zen/go/v1/responses
Claude Code --(Messages)-----> http://127.0.0.1:11447/v1/messages --+--> /messages passthrough (14 models)
                                                                  +--> bridge to /chat (12 models: GLM, Kimi 2.x, MiMo, Hy, Omen)
                                                                  +--> bridge to /responses (4 models: Muse x2, GPT Luna, Grok)
Any OpenAI client -----------> http://127.0.0.1:11447/v1/chat/completions -----> https://opencode.ai/zen/go/v1/chat/completions
```

The proxy forwards **all** headers (Go requires session identifiers — `x-opencode-session` or the client's native one — plus its own User-Agent), injects a session when missing, and records estimated spend in `data/usage.jsonl` + `GET /stats`.

## Install

Prerequisite: Node 18+.

```powershell
cd <repo-folder>
Copy-Item config.example.json config.json
notepad config.json   # paste your OpenCode Go sk-...
npm run proxy
```

## Quickstart for a friend (fresh install)

1. Install via `OpenCodeGoProxy Setup X.exe` (Desktop + Start Menu).
2. Open from the tray → paste the OpenCode Go key (`name|sk-...|budget`) → Save.
3. Tray → **Restart app+proxy**.
4. **Profiles** tab: enable Codex and/or Claude Code (automatic, reversible backup).
5. `setx OPENCODE_GO_PROXY_KEY "local"` (Codex needs this env var with any value).
6. Done: `codex` and `claude` use the proxy; going back to normal is one click.

## Configuration (`config.json`)

| Field | Quota effect |
|---|---|
| `keys[].dayBudgetUsd` | estimated daily cap per key — exhausted keys leave the rotation |
| `models.<id>.enabled=false` | blocks pricey models (e.g. `kimi-k3`, `qwen3.8-max`) |
| `models.<id>.maxOutputTokens` | per-request output token cap |
| `models.<id>.maxReasoningEffort` | reasoning cap (`medium` saves a lot vs `max`) |
| `models.<id>.stripCodexApps` | drops `mcp__codex_apps__*` namespaces (Gmail/GitHub/Drive). Default true on Muse (fatal), false elsewhere. Measured: ~84k input tokens saved per Muse turn |
| `models.<id>.bridge` | `auto` (default), `chat`, `responses` or `false`. Forces the `/messages` bridge mode |
| `models.<id>.toolsAllow` | tool allowlist on the bridge. Default on strict (Muse): Bash, Read, Write, Edit, Glob, Grep, TodoWrite, WebFetch, WebSearch |
| `models.<id>.nudgeTools` | anti-"lazy DONE" instruction on strict (Muse): always act via tools |
| `models.<id>.vision` | `auto` (default), `true` or `false`. `auto` captions via vision model only for proven-blind models (Muse 1.2/1.3, Kimi 2.6, non-flash GLM 5.x) |
| `visionModel` (top-level) | captioning model (default `glm-5.3-flash`), hash-cached in `data/vision-cache.json` |
| `defaults.*` | defaults for unlisted models |

Cheap daily drivers: `deepseek-v4.1-flash`, `muse-spark-1.3-contributor`, `glm-5.3-flash`, `mimo-v2.5`.

## Profiles: Normal <-> Proxy (GUI panel)

The panel's **Profiles** section switches Codex and Claude Code between the
normal profile and the proxy, **with restorable backup**
(`config.toml.pre-oc-gui`, `settings.json.pre-oc-gui` + timestamped copies):

- **Codex**: swaps `model`/`model_provider`/`model_catalog_json` in the base
  `config.toml` — applies to CLI **and** App (the App ignores overrides, hence base).
- **Claude Code**: swaps only endpoint+key in `settings.json` (user models
  preserved). Covers CLI and the VS Code extension (same backend).
- Going back restores the backup **byte for byte**. State is detected by
  reading (survives restarts).

## One-time setup

```powershell
npm run setup:codex -- --model deepseek-v4.1-flash
```

This creates: the `opencode_go_proxy` provider in `config.toml`, the
`opencode-go-proxy-models.json` catalog (generated from live `/models`) and the
`opencode-go-proxy` profile (handy for advanced CLI: `codex --profile opencode-go-proxy`).

With the proxy sanitizing, **no need** for `[features] apps = false`.

Set `OPENCODE_GO_PROXY_KEY` to any value (the real key lives in the proxy's `config.json`):
```powershell
setx OPENCODE_GO_PROXY_KEY "local"
```

## Claude Code (details)

Models with a native `/messages` endpoint on Go pass through; the rest use
the bridge (`/chat` or `/responses`, automatic per model, configurable via
`models.<id>.bridge`). `npm run setup:claude` prints manual env vars — but the
panel switch is recommended. Opus/Sonnet/Haiku slots are editable in the panel
(Claude has no model catalog — only 3 tiers + `--model`).

## Tray app (Electron)

```powershell
npm i -D electron
npm run app
```

Panel: **Profiles** (Normal↔Proxy for Codex and Claude), keys
(`name|sk-...|budget`), vision model, **System** (start with Windows, start
minimized), spend reading (`/stats`). The app minimizes to the tray.

Icon: official OpenCode mark (`assets/`, from the public anomalyco/opencode repo).

## Proxy endpoints

| Route | Use |
|---|---|
| `POST /v1/responses` | Codex (`wire_api = "responses"`) |
| `POST /v1/chat/completions` | OpenAI-compatible clients |
| `POST /v1/messages` | Claude Code |
| `GET /v1/models` | catalog (1h cache) |
| `GET /health`, `GET /stats` | status and estimated spend |

## Notes

- USD estimates use Go docs peak prices — treat as order of magnitude.
- Respect OpenCode Go terms (one session per conversation, identifiable client, no abuse) — the proxy does this by default.
