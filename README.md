# OpenCodeGoProxy

Proxy local para usar **todos os modelos do OpenCode Go** no **Codex (CLI + App)** e no **Claude Code**, com:

- **Multi-key**: várias API keys do OpenCode Go com round-robin + fallback em 429/5xx.
- **Sanitização por modelo**: remove schemas recursivos (`$ref` cíclico, ex: tools do Gmail no Codex) e converte tools `custom` — o motivo real do erro `Recursive JSON schemas are not currently supported` no Muse Spark.
- **Travas de cota**: allowlist de modelos, `maxOutputTokens`, teto de reasoning effort e orçamento diário estimado (USD) por key. Estimativas locais — o console oficial (`opencode.ai/auth`) é a verdade.
- **Setup guiado** para Codex e Claude Code + **app Electron** que vive no tray.

Relacionado/inspiração (todos open source): `lidge-jun/opencodex` (proxy universal Codex/Claude, MIT), `duolahypercho/codex-router` (router p/ Codex App+CLI), `routatic/proxy` (ex `oc-go-cc`, Claude Code ↔ Go/Zen), `xb0or/opencode-GO` (gateway multi-key), `Hiyajomaho-num9/opencode-go-codex` (2api Chat→Responses p/ Codex). Nenhum juntava sanitização de schemas + travas de cota + tray Windows — por isso este repo existe.

## Como funciona

```
Codex CLI/App --(Responses)--> http://127.0.0.1:11447/v1/responses --sanitiza--> https://opencode.ai/zen/go/v1/responses
Claude Code --(Messages)-----> http://127.0.0.1:11447/v1/messages --+--> passthrough /messages (14 modelos)
                                                                  +--> bridge p/ /chat (12 modelos: GLM, Kimi 2.x, MiMo, Hy, Omen)
                                                                  +--> bridge p/ /responses (4 modelos: Muse x2, GPT Luna, Grok)
Qualquer client OpenAI ------> http://127.0.0.1:11447/v1/chat/completions -----> https://opencode.ai/zen/go/v1/chat/completions
```

O proxy encaminha **todos** os headers (o Go exige identificadores de sessão — `x-opencode-session` ou o nativo do client — e User-Agent próprio), injeta sessão quando falta e registra gasto estimado em `data/usage.jsonl` + `GET /stats`.

## Instalação

Pré-requisito: Node 18+.

```powershell
cd C:\Antigravity\OpenCodeGoProxy
Copy-Item config.example.json config.json
notepad config.json   # coloque sua(s) sk-... do OpenCode Go
npm run proxy
```

## Configuração (`config.json`)

| Campo | Efeito na cota |
|---|---|
| `keys[].dayBudgetUsd` | trava diária estimada por key — key estourada sai do rodízio |
| `models.<id>.enabled=false` | bloqueia modelo caro (ex: `kimi-k3`, `qwen3.8-max`) |
| `models.<id>.maxOutputTokens` | teto de tokens de saída por request |
| `models.<id>.maxReasoningEffort` | teto de reasoning (`medium` economiza muito vs `max`) |
| `models.<id>.stripCodexApps` | remove namespaces `mcp__codex_apps__*` (Gmail/GitHub/Drive). Default true no Muse (fatal), false nos demais. Medido: ~84k input tokens poupados por turno no Muse |
| `models.<id>.bridge` | `auto` (default), `chat`, `responses` ou `false`. Força o modo da bridge `/messages` |
| `models.<id>.toolsAllow` | allowlist de tools na bridge. Default nos strict (Muse): Bash, Read, Write, Edit, Glob, Grep, TodoWrite, WebFetch, WebSearch |
| `models.<id>.nudgeTools` | instrução anti-"DONE preguiçoso" nos strict (Muse): agir via tools sempre |
| `defaults.*` | padrão para modelos não listados |

Modelos baratos e bons p/ dia a dia: `deepseek-v4.1-flash`, `muse-spark-1.3-contributor`, `glm-5.3-flash`, `mimo-v2.5`.

## Profiles: Normal <-> Proxy (painel GUI)

A seção **Profiles** do painel alterna Codex e Claude Code entre o profile
normal e o proxy, **com backup restaurável** (`config.toml.pre-oc-gui`,
`settings.json.pre-oc-gui` + cópias com timestamp):

- **Codex**: troca `model`/`model_provider`/`model_catalog_json` no `config.toml`
  base — vale para CLI **e** App (o App ignora overrides, por isso é no base).
- **Claude Code**: troca só endpoint+key no `settings.json` (modelos do usuário
  preservados). Cobre CLI e extensão do VS Code (mesmo backend).
- Voltar = restaura o backup **byte a byte**. Estado detectado por leitura
  (sobrevive a reinícios).

## Setup inicial (uma vez)

```powershell
npm run setup:codex -- --model deepseek-v4.1-flash
```

Isso cria: provider `opencode_go_proxy` no `config.toml`, catálogo `opencode-go-proxy-models.json` (gerado do `/models` live) e o profile `opencode-go-proxy` (útil p/ CLI avançado: `codex --profile opencode-go-proxy`).

Com o proxy sanitizando, **não precisa** de `[features] apps = false`.

Defina `OPENCODE_GO_PROXY_KEY` com qualquer valor (a key real fica no `config.json` do proxy):
```powershell
setx OPENCODE_GO_PROXY_KEY "local"
```

## Claude Code (detalhes)

Modelos com endpoint nativo `/messages` no Go passam direto; os demais usam
a bridge (`/chat` ou `/responses`, automático por modelo, configurável via
`models.<id>.bridge`). `npm run setup:claude` mostra as variáveis de ambiente
manuais — mas o recomendado é o switch no painel.

## App com tray (Electron)

```powershell
npm i -D electron
npm run app
```

Painel: **Profiles** (Normal↔Proxy p/ Codex e Claude), atalhos, porta, keys (`nome|sk-...|orcamento`), modelos bloqueados e leitura de gasto (`/stats`). O app minimiza para o tray.

## Endpoints do proxy

| Rota | Uso |
|---|---|
| `POST /v1/responses` | Codex (`wire_api = "responses"`) |
| `POST /v1/chat/completions` | clients OpenAI-compatíveis |
| `POST /v1/messages` | Claude Code |
| `GET /v1/models` | catálogo (cache 1h) |
| `GET /health`, `GET /stats` | status e gasto estimado |

## Notas

- Estimativas de USD usam preços de pico da doc do Go — trate como ordem de grandeza.
- Respeite os termos do OpenCode Go (sessão por conversa, client identificável, sem abuso) — o proxy já faz isso por padrão.
