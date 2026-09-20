# OpenCodeGoProxy — Technical documentation

> Local proxy (Windows) that puts **every OpenCode Go model** to work in
> **Codex (CLI + App)** and **Claude Code (CLI)**, with multi-key, per-model
> sanitization, quota guards and a tray panel.

## Contents

1. [Architecture](#1-architecture)
2. [Proxy routes](#2-proxy-routes)
3. [Per-model sanitization](#3-per-model-sanitization)
4. [Anthropic ↔ Chat/Responses bridge](#4-anthropic--chatresponses-bridge)
5. [Image decoder (blind models)](#5-image-decoder-blind-models)
6. [Reasoning switch](#6-reasoning-switch)
7. [Multi-key, rotation and quota](#7-multi-key-rotation-and-quota)
8. [Normal ↔ Proxy profiles](#8-normal--proxy-profiles)
9. [Validated model matrix](#9-validated-model-matrix)
10. [`config.json` reference](#10-configjson-reference)
11. [Desktop app (tray)](#11-desktop-app-tray)
12. [Troubleshooting](#12-troubleshooting)
13. [Development and release](#13-development-and-release)

---

## 1. Architecture

```
Codex CLI / Codex App (Responses) ──┐
                                    ├─► http://127.0.0.1:11447 ──► proxy ──► https://opencode.ai/zen/go/v1
Claude Code CLI (Messages) ─────────┘        │ sanitize │ translate │ caption │ measure
                                             └──────────┴───────────┴─────────┴─────► ledger (data/)
```

- **Zero runtime dependencies** (`node src/proxy.mjs` runs on stock Node 18+).
- All traffic preserves session identifiers (`x-opencode-session` or the
  client's native one) plus its own User-Agent — an OpenCode Go requirement.
- Default port `11447` (configurable; `OPENCODE_GO_PROXY_PORT` wins in dev).

Modules (`src/`):

| File | Role |
|---|---|
| `proxy.mjs` | HTTP server, routing, ledger, SSE |
| `policies.mjs` | sanitization + per-model policies |
| `anthropic-bridge.mjs` | Messages ↔ Chat/Responses translation (both ways, streaming) |
| `vision.mjs` | image decoder + hash cache |
| `model-meta.mjs` | proper names, per-model reasoning, unavailable list |
| `keypool.mjs` | round-robin, failover, daily budget, ledger |
| `prices.mjs` | peak prices/1M (local estimate; official console wins) |
| `catalog.mjs` | Codex model-catalog generator (37 → 30 models) |
| `profile-codex.mjs` / `profile-claude.mjs` | Normal ↔ Proxy switch with backup |
| `gui-api.mjs` | panel API (via IPC), headless-testable |
| `config-path.mjs` | resolution repo → `%APPDATA%` → env |
| `app-settings.mjs` | autostart (Run registry), minimized |
| `setup*.mjs`, `app-activate/restore.mjs` | first-time setup and legacy helpers |

## 2. Proxy routes

| Route (with or without `/v1` prefix) | From | Upstream |
|---|---|---|
| `POST /responses` | Codex (`wire_api = "responses"`) | `/responses` (+ sanitization) |
| `POST /chat/completions` | OpenAI-compatible clients | `/chat/completions` (passthrough) |
| `POST /messages` | Claude Code | `/messages` direct (14 models) or bridge (16 models) |
| `GET /models` | catalogs | `/models` (1h cache) |
| `GET /health`, `GET /stats` | panel/diagnostics | local |

## 3. Per-model sanitization

The project's core finding: the **Muse Spark upstream (Console Go/Meta)
rejects recursive JSON schemas** (`Recursive JSON schemas are not currently
supported`) and **`custom` tools** (`custom tools are not supported`) — while
DeepSeek & co. tolerate them. Codex sends ~28 tools per turn, including the
`codex_apps` namespaces (Gmail/GitHub/Drive) with a cyclic `$ref`
(`GmailMessagePartRequest`) and freeform `apply_patch` (`custom`).

Per request, the proxy:
1. Drops `mcp__codex_apps__*` namespaces when policy says so
   (`stripCodexApps`; default ON on Muse) — measured: **~84k input tokens
   saved per turn**.
2. Drops sub-tools with recursive `$defs` (keeps the healthy ones).
3. Converts known `custom` (`apply_patch` → plain function) or drops.
4. Enforces `max_output_tokens` and reasoning-effort caps.

Honest limits (test-proven): `apply_patch` is **impossible** on Muse via Codex
(upstream rejects `custom`, Codex rejects the `function` round-trip —
`incompatible payload`), and namespaced `codex_apps` tools return
`unsupported call` on Muse (the model fumbles the envelope; DeepSeek works).
Shell editing covers the gap.

## 4. Anthropic ↔ Chat/Responses bridge

Claude Code only speaks `/messages`, but only 14 Go models have that endpoint
natively (DeepSeek ×5, Kimi K3, MiniMax ×3, Qwen ×5). For the other 16, the
proxy translates:

- **→ `/chat`** (12: GLM, Kimi 2.x, MiMo, Hy, LongCat, Omen…): request
  (system, text/image/tool_use/tool_result, tools, tool_choice, caps) and
  response (text/tool_use, `stop_reason`, usage), including **bidirectional SSE
  streaming** with `include_usage`.
- **→ `/responses`** (4 responses-only: Muse ×2, GPT 5.6 Luna, Grok 4.6):
  translates to `input`/`instructions`/function tools and back, also streaming
  (with `input_json` anti-duplication buffering — a real bug that caused a
  97-turn loop before the fix).
- Errors become Anthropic envelopes (`invalid_request_error`, `api_error`…).

Bridge extras: tool allowlist for strict (`toolsAllow`, 9 essentials on Muse:
−119KB of schemas/turn) and `nudgeTools` (anti-"lazy DONE" instruction).
Measured on Muse: from a ~57k-token/turn loop to a complete task in ~3 turns
of ~6k.

## 5. Image decoder (blind models)

Control quiz (letter "S"):

- **See natively**: vision-exp, GLM-5.3-**Flash**, DeepSeek V4.1/Pro, GPT 5.6 Luna,
  Kimi K3, MiMo V2.5, MiniMax, Qwen.
- **Blind**: Muse 1.2/1.3 (burns budget with no answer), Kimi 2.6 (empty),
  GLM-5.3 (explicit reject; Flash sees — important nuance).

For proven-blind models (`vision: auto`), the proxy sends the image to the
configured vision model (default `glm-5.3-flash`, fallback chain), swaps the
block for `[image N: <caption>]` and carries on. SHA-256 cache in
`data/vision-cache.json` (repeats are free), cost on the ledger. Validated:
GLM-5.3 answered "S" ($0.0004).

The captioner uses an "agent eyes" system prompt (image type, elements with
exact labels and states, verbatim error/code transcription, "unreadable"
instead of guessing) + the user's question as focus. Empties never enter the
cache; total failure yields an honest marker (anti-hallucination).

## 6. Reasoning switch

Codex exposes slots (Low/Medium/High); each model has native variants
(`none/high/max` on DeepSeek, `low/high/max` on Kimi K3/GLM…). The catalog
shows the slots with honest descriptions and **the proxy translates to the
real effort** (`low → none` on DeepSeek etc.). Models without documented
variants use passthrough.

## 7. Multi-key, rotation and quota

- Per-request round-robin + failover on 429/5xx to the next healthy key.
- Exhausted keys (`dayBudgetUsd`) silently leave the rotation.
- **429 only when ALL are exhausted** (upstream or budget); `retry-after`
  forwarded. Everything else is 502.
- Daily ledger per key (`data/ledger.json`) + per-request `usage.jsonl`
  (>10MB rotation) + `GET /stats`.
- Per-model guards: `enabled`, `maxOutputTokens`, `maxReasoningEffort`,
  `stripCodexApps`, `bridge`, `toolsAllow`, `nudgeTools`, `vision`.

## 8. Normal ↔ Proxy profiles

- **Codex**: swaps `model`/`model_provider`/`model_catalog_json` in the base
  `config.toml` (the App ignores `-c` overrides in the picker — hence base).
  Applies to CLI **and** App.
- **Claude Code**: swaps only endpoint+key in `settings.json` (user models/
  tiers preserved). Covers CLI and the VS Code extension. Opus/Sonnet/Haiku
  selectors in the panel (Claude has no catalog — 3 slots + `--model` only).
- Backup `*.pre-oc-gui` (+ timestamped, + recognized legacy `pre-oc-proxy`);
  going back restores **byte for byte**. State detected by reading.
- Note: with a custom key in env, Claude asks once
  ("Do you want to use this API key?") — answer **Yes**; the panel pre-approves
  (`customApiKeyResponses`) so it doesn't repeat.

## 9. Validated model matrix

30/37 on Codex (via proxy) and 30/30 on Claude Code (14 direct + 16 bridge).
**Upstream-unavailable** (out of the catalog): `kimi-k2.5`, `glm-5`,
`mimo-v2-pro`, `mimo-v2-omni`, `hy3-preview`, `grok-4.5`, `qwen3.5-plus`.
Full tool-loop proven on: Muse 1.3, DeepSeek V4.1/V4-Pro, MiniMax M2.7/M3,
GLM-5.3-Flash, Qwen3.8-Flash, Kimi K3, Grok 4.6. Suggested Claude lineup:
Opus=Muse 1.3, Sonnet=DeepSeek V4.1 Flash, Haiku=GLM 5.3 Flash.

## 10. `config.json` reference

```jsonc
{
  "port": 11447,
  "upstream": "https://opencode.ai/zen/go/v1",
  "visionModel": "glm-5.3-flash",
  "defaults": {
    "maxOutputTokens": 8192, "maxReasoningEffort": "high",
    "stripCodexApps": true, "bridge": "auto", "vision": "auto"
  },
  "keys": [{ "name": "principal", "key": "sk-...", "dayBudgetUsd": 2.0 }],
  "models": {
    "kimi-k3": { "maxReasoningEffort": "medium" },
    "qwen3.8-max": { "maxOutputTokens": 4096 },
    "muse-spark-1.3-contributor": {}
  }
}
```

Keys live in `%APPDATA%\OpenCodeGoProxy\config.json` (never in git).
`OPENCODE_GO_PROXY_KEY=local` (any value) is required by the Codex provider.

## 11. Desktop app (tray)

NSIS installer (`OpenCodeGoProxy Setup X.exe`): Desktop + Start Menu, no
terminal (GUI exe), dark tray panel, single instance, `--minimized`,
optional autostart (Run registry) and `Restart app+proxy`. Icon = official
OpenCode mark. Settings in `%APPDATA%\OpenCodeGoProxy\`.

## 12. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `Recursive JSON schemas…` (no proxy) | Gmail schemas on Muse | use via proxy |
| `custom tools are not supported` | freeform `apply_patch` on Muse | catalog without freeform for Muse (default) |
| `unsupported call: mcp__codex_apps__*` on Muse | namespaced envelope | model limitation; shell covers it |
| App picker lists only GPT | App ignores `-c` | switch writes to base (panel) |
| Claude asks about the key every time | not pre-approved | panel pre-approves; or Yes once |
| Fable in the picker | active OAuth login | `/logout` (optional) |
| `Quit` doesn't close / duplicated | fixed v0.9.2 (isQuitting + lock) | update |
| `token_usage was None` on compact | old `chat` wire | use Responses via proxy |
| Port in use | 2nd instance | message guides; app lock prevents it |

## 13. Development and release

- `npm run proxy` (dev) · `npm run dist` (installer) · tests outside the repo.
- Convention: runtime fixes → patch; features → minor; `commit -m "vX.Y.Z: ..."`.
- Release: `gh release create vX.Y.Z "dist/OpenCodeGoProxy Setup X.Y.Z.exe"`.
