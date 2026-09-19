# OpenCodeGoProxy — Documentação técnica

> Proxy local (Windows) que coloca **todos os modelos do OpenCode Go** para
> trabalhar no **Codex (CLI + App)** e no **Claude Code (CLI)**, com
> multi-key, sanitização por modelo, travas de cota e painel no tray.
> Repositório privado: `moesuito/OpenCodeGoProxy` · Release atual: **v1.0.0**.

## Índice

1. [Arquitetura](#1-arquitetura)
2. [Rotas do proxy](#2-rotas-do-proxy)
3. [Sanitização por modelo](#3-sanitização-por-modelo)
4. [Bridge Anthropic ↔ Chat/Responses](#4-bridge-anthropic--chatresponses)
5. [Image decoder (modelos cegos)](#5-image-decoder-modelos-cegos)
6. [Reasoning switch](#6-reasoning-switch)
7. [Multi-key, rotação e cota](#7-multi-key-rotação-e-cota)
8. [Profiles Normal ↔ Proxy](#8-profiles-normal--proxy)
9. [Matriz de modelos validada](#9-matriz-de-modelos-validada)
10. [Referência do `config.json`](#10-referência-do-configjson)
11. [App desktop (tray)](#11-app-desktop-tray)
12. [Solução de problemas](#12-solução-de-problemas)
13. [Desenvolvimento e release](#13-desenvolvimento-e-release)

---

## 1. Arquitetura

```
Codex CLI / Codex App (Responses) ──┐
                                    ├─► http://127.0.0.1:11447 ──► proxy ──► https://opencode.ai/zen/go/v1
Claude Code CLI (Messages) ─────────┘        │ sanitiza │ traduz │ legenda │ mede
                                             └──────────┴────────┴─────────┴─────► ledger (data/)
```

- **Zero dependências** em runtime (`node src/proxy.mjs` roda com Node 18+ puro).
- Todo o tráfego preserva identificadores de sessão (`x-opencode-session` ou o
  nativo do client) e User-Agent próprio — exigência do OpenCode Go.
- Porta padrão `11447` (configurável; `OPENCODE_GO_PROXY_PORT` tem precedência
  em dev).

Módulos (`src/`):

| Arquivo | Papel |
|---|---|
| `proxy.mjs` | servidor HTTP, roteamento, ledger, SSE |
| `policies.mjs` | sanitização + políticas por modelo |
| `anthropic-bridge.mjs` | tradução Messages ↔ Chat/Responses (ida e volta, streaming) |
| `vision.mjs` | image decoder + cache por hash |
| `model-meta.mjs` | nomes próprios, reasoning por modelo, lista de indisponíveis |
| `keypool.mjs` | round-robin, fallback, budget diário, ledger |
| `prices.mjs` | preços de pico/1M (estimativa local; console oficial vale) |
| `catalog.mjs` | gerador do model-catalog do Codex (37 → 30 modelos) |
| `profile-codex.mjs` / `profile-claude.mjs` | switch Normal ↔ Proxy com backup |
| `gui-api.mjs` | API do painel (via IPC), testável headless |
| `config-path.mjs` | resolução repo → `%APPDATA%` → env |
| `app-settings.mjs` | autostart (Registro Run), minimizado |
| `setup*.mjs`, `app-activate/restore.mjs` | setup inicial e atalhos legados |

## 2. Rotas do proxy

| Rota (com ou sem prefixo `/v1`) | Origem | Destino upstream |
|---|---|---|
| `POST /responses` | Codex (`wire_api = "responses"`) | `/responses` (+ sanitização) |
| `POST /chat/completions` | clients OpenAI-compatíveis | `/chat/completions` (passthrough) |
| `POST /messages` | Claude Code | `/messages` direto (14 modelos) ou bridge (16 modelos) |
| `GET /models` | catálogos | `/models` (cache 1h) |
| `GET /health`, `GET /stats` | painel/diagnóstico | local |

## 3. Sanitização por modelo

Descoberta central do projeto: o upstream do **Muse Spark (Console Go/Meta)
rejeita schemas JSON recursivos** (`Recursive JSON schemas are not currently
supported`) e **tools `custom`** (`custom tools are not supported`) — enquanto
DeepSeek & cia. toleram. O Codex envia ~28 tools por turno, incluindo os
namespaces `codex_apps` (Gmail/GitHub/Drive) com `$ref` cíclico
(`GmailMessagePartRequest`) e `apply_patch` freeform (`custom`).

O proxy, por request:
1. Remove namespaces `mcp__codex_apps__*` quando a política manda
   (`stripCodexApps`; default ON no Muse) — medido: **~84k input tokens
   poupados por turno**.
2. Remove sub-tools com `$defs` recursivo (mantém as saudáveis do namespace).
3. Converte `custom` conhecido (`apply_patch` → function simples) ou remove.
4. Aplica teto de `max_output_tokens` e de reasoning effort.

Limites honestos (validados com teste): `apply_patch` é **impossível** no Muse
via Codex (upstream rejeita `custom`, Codex rejeita a volta `function` —
`incompatible payload`), e tools namespaced `codex_apps` retornam
`unsupported call` no Muse (o modelo erra o envelope; no DeepSeek funciona).
Edição via shell cobre o gap.

## 4. Bridge Anthropic ↔ Chat/Responses

Claude Code só fala `/messages`, mas só 14 modelos Go têm esse endpoint nativo
(DeepSeek ×5, Kimi K3, MiniMax ×3, Qwen ×5). Para os outros 16, o proxy traduz:

- **→ `/chat`** (12: GLM, Kimi 2.x, MiMo, Hy, LongCat, Omen…): request
  (system, text/image/tool_use/tool_result, tools, tool_choice, caps) e
  response (text/tool_use, `stop_reason`, usage), incluindo **streaming SSE
  bidirecional** com `include_usage`.
- **→ `/responses`** (4 responses-only: Muse ×2, GPT 5.6 Luna, Grok 4.6):
  traduz para `input`/`instructions`/function tools e de volta, também com
  streaming (com buffer anti-duplicação de `input_json` — bug real que causou
  loop de 97 turnos antes do fix).
- Erros viram envelope Anthropic (`invalid_request_error`, `api_error`…).

Extras da bridge: allowlist de tools p/ strict (`toolsAllow`, 9 essenciais no
Muse: −119KB de schemas/turno) e `nudgeTools` (instrução anti-"DONE
preguiçoso"). Resultado medido no Muse: de loop de ~57k tokens/turno para
tarefa completa em ~3 turnos de ~6k.

## 5. Image decoder (modelos cegos)

Quiz de controle (letra "S", 2026-09-19):

- **Enxergam**: vision-exp, GLM-5.3-**Flash**, DeepSeek V4.1/Pro, GPT 5.6 Luna,
  Kimi K3, MiMo V2.5, MiniMax, Qwen.
- **Cegos**: Muse 1.2/1.3 (queima budget sem responder), Kimi 2.6 (vazio),
  GLM-5.3 (rejeita explícito; o Flash vê — nuance importante).

Quando o modelo é comprovadamente cego (`vision: auto`), o proxy envia a
imagem ao `deepseek-v4-flash-vision-exp`, substitui o bloco por
`[imagem N: <legenda>]` e segue. Cache por SHA-256 em
`data/vision-cache.json` (repetir sai de graça), custo registrado no ledger.
Validado: GLM-5.3 respondeu "S" (custou $0,0004).

## 6. Reasoning switch

O Codex expõe slots (Low/Médio/Alto); cada modelo tem variantes nativas
(`none/high/max` no DeepSeek, `low/high/max` no Kimi K3/GLM…). O catálogo
mostra os slots com descrição honesta e **o proxy traduz para o effort real**
(`low → none` no DeepSeek etc.). Modelos sem variante documentada usam
passthrough.

## 7. Multi-key, rotação e cota

- Round-robin por request + fallback em 429/5xx para a próxima saudável.
- Keys estouradas (`dayBudgetUsd`) saem do rodízio em silêncio.
- **429 só quando TODAS zerarem** (upstream ou budget); `retry-after`
  repassado. Resto é 502.
- Ledger diário por key (`data/ledger.json`) + `usage.jsonl` por request
  (rotação >10MB) + `GET /stats`.
- Travas por modelo: `enabled`, `maxOutputTokens`, `maxReasoningEffort`,
  `stripCodexApps`, `bridge`, `toolsAllow`, `nudgeTools`, `vision`.

## 8. Profiles Normal ↔ Proxy

- **Codex**: troca `model`/`model_provider`/`model_catalog_json` no
  `config.toml` base (o App ignora overrides `-c` no picker — por isso é no
  base). Vale p/ CLI **e** App.
- **Claude Code**: troca só endpoint+key no `settings.json` (modelos/tiers do
  usuário preservados). Cobre CLI e extensão VS Code. Seletores
  Opus/Sonnet/Haiku no painel (Claude não tem catálogo — só 3 slots + `--model`).
- Backup `*.pre-oc-gui` (+ timestamped, + legado `pre-oc-proxy` reconhecido);
  voltar = restaura **byte a byte**. Estado detectado por leitura.
- Detalhe: com key custom no env, o Claude pergunta uma vez
  ("Do you want to use this API key?") — responda **Yes**; o painel pré-aprova
  (`customApiKeyResponses`) para não repetir.

## 9. Matriz de modelos validada

30/37 no Codex (via proxy) e 30/30 no Claude Code (14 direto + 16 bridge).
**Indisponíveis no upstream** (fora do catálogo): `kimi-k2.5`, `glm-5`,
`mimo-v2-pro`, `mimo-v2-omni`, `hy3-preview`, `grok-4.5`, `qwen3.5-plus`.
Full-loop com tools provado em: Muse 1.3, DeepSeek V4.1/V4-Pro, MiniMax M2.7/M3,
GLM-5.3-Flash, Qwen3.8-Flash, Kimi K3, Grok 4.6. Lineup sugerido no Claude:
Opus=Muse 1.3, Sonnet=DeepSeek V4.1 Flash, Haiku=GLM 5.3 Flash.

## 10. Referência do `config.json`

```jsonc
{
  "port": 11447,
  "upstream": "https://opencode.ai/zen/go/v1",
  "visionModel": "deepseek-v4-flash-vision-exp",
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

Chaves ficam em `%APPDATA%\OpenCodeGoProxy\config.json` (nunca no git).
`OPENCODE_GO_PROXY_KEY=local` (qualquer valor) é exigida pelo provider Codex.

## 11. App desktop (tray)

Instalador NSIS (`OpenCodeGoProxy Setup X.exe`): Desktop + Menu Iniciar, sem
terminal (exe GUI), tray com painel dark, instância única, `--minimized`,
autostart opcional (Registro Run) e `Reiniciar app+proxy`. Ícone = marca
oficial OpenCode. Settings em `%APPDATA%\OpenCodeGoProxy\`.

## 12. Solução de problemas

| Sintoma | Causa provável | Ação |
|---|---|---|
| `Recursive JSON schemas…` (sem proxy) | schemas do Gmail no Muse | usar via proxy |
| `custom tools are not supported` | `apply_patch` freeform no Muse | catálogo sem freeform p/ Muse (padrão) |
| `unsupported call: mcp__codex_apps__*` no Muse | envelope namespaced | limitação do modelo; shell cobre |
| Picker do App só lista GPT | App ignora `-c` | switch põe no base (painel) |
| Claude pergunta da key toda vez | sem pré-aprovação | painel pré-aprova; ou Yes 1 vez |
| Fable no picker | login OAuth ativo | `/logout` (opcional) |
| `Sair` não fecha / duplicado | corrigido v0.9.2 (isQuitting + lock) | atualizar |
| `token_usage was None` no compact | wire `chat` antigo | usar Responses via proxy |
| Porta ocupada | 2ª instância | mensagem orienta; lock impede no app |

## 13. Desenvolvimento e release

- `npm run proxy` (dev) · `npm run dist` (instalador) · testes em
  `C:\Users\<voce>\AppData\Local\Temp\opencode\` (fora do repo).
- Convenção: correções de runtime → patch; features → minor; `commit -m "vX.Y.Z: ..."`.
- Release: `gh release create vX.Y.Z "dist/OpenCodeGoProxy Setup X.Y.Z.exe"`.
  Repo privado: colaborador precisa de acesso para baixar.
