// Metadados curados por modelo do OpenCode Go (a API /models so expoe IDs).
// - NAMES: nome proprio p/ o picker (sem sufixo de provider).
// - REASONING: niveis visiveis no Codex (slots) + traducao p/ o effort real
//   enviado ao upstream (o proxy aplica REASONING_MAP). O slot mais baixo
//   sempre equivale ao "off" do modelo (none/instant), quando conhecido.
// Fontes: https://opencode.ai/docs/go/ e variantes observadas no OpenCode.
export const NAMES = {
  "minimax-m3": "MiniMax M3",
  "minimax-m2.7": "MiniMax M2.7",
  "minimax-m2.5": "MiniMax M2.5",
  "kimi-k3": "Kimi K3",
  "kimi-k2.7-code": "Kimi K2.7 Code",
  "kimi-k2.6": "Kimi K2.6",
  "kimi-k2.5": "Kimi K2.5",
  "longcat-2.0": "LongCat 2.0",
  "glm-5.3-flash": "GLM 5.3 Flash",
  "glm-5.3": "GLM 5.3",
  "glm-5.2": "GLM 5.2",
  "glm-5.1": "GLM 5.1",
  "glm-5": "GLM 5",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-flash": "DeepSeek Flash",
  "deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "deepseek-v4-flash-vision-exp": "DeepSeek V4 Flash Vision",
  "qwen3.8-max": "Qwen 3.8 Max",
  "qwen3.8-flash": "Qwen 3.8 Flash",
  "qwen3.7-max": "Qwen 3.7 Max",
  "qwen3.7-plus": "Qwen 3.7 Plus",
  "qwen3.6-plus": "Qwen 3.6 Plus",
  "qwen3.5-plus": "Qwen 3.5 Plus",
  "mimo-v2-pro": "MiMo V2 Pro",
  "mimo-v2-omni": "MiMo V2 Omni",
  "mimo-v2.5-pro": "MiMo V2.5 Pro",
  "mimo-v2.5": "MiMo V2.5",
  "hy4-preview": "Hy4 Preview",
  "hy3-preview": "Hy3 Preview",
  hy3: "Hy3",
  "gpt-5.6-luna": "GPT 5.6 Luna",
  "grok-4.6": "Grok 4.6",
  "grok-4.5": "Grok 4.5",
  "muse-spark-1.3-contributor": "Muse Spark 1.3",
  "muse-spark-1.2-contributor": "Muse Spark 1.2",
  "omen-alpha": "Omen Alpha",
};

export function displayName(id) {
  return NAMES[id] || id;
}

// Upstreams que NAO toleram `custom` tools nem schemas recursivos.
// Neles o proxy aplica sanitizacao total (inclui strip dos apps).
const STRICT_RES = [/^muse-spark-.+/];

export function isStrictUpstream(id) {
  return STRICT_RES.some((re) => re.test(id));
}

// Janela de contexto REAL por modelo (fontes: OpenRouter + docs Go + catalogo legado).
// auto_compact = 90% (regra observada nos catalogos: 943718 = 90% de 1048576).
// gpt-5.6-luna: OpenRouter diz 1050000, mas o servico Go precifica por faixas
// de 272K e o catalogo legado usava max 872000 -> conservador 872000.
// omen-alpha: sem dado publico -> fallback 200000.
const CONTEXT = {
  "muse-spark-1.3-contributor": [1048576, 1048576],
  "muse-spark-1.2-contributor": [1048576, 1048576],
  "deepseek-v4.1-flash": [1048576, 1048576],
  "deepseek-v4-pro": [1048576, 1048576],
  "deepseek-v4-flash": [1048576, 1048576],
  "deepseek-flash": [1048576, 1048576],
  "deepseek-v4-flash-vision-exp": [1048576, 1048576],
  "gpt-5.6-luna": [872000, 872000],
  "kimi-k3": [1048576, 1048576],
  "kimi-k2.7-code": [262144, 262144],
  "kimi-k2.6": [262144, 262144],
  "longcat-2.0": [1048576, 1048576],
  "glm-5.3-flash": [1048576, 1048576],
  "glm-5.3": [1048576, 1048576],
  "glm-5.2": [1048576, 1048576],
  "glm-5.1": [204800, 204800],
  "qwen3.8-max": [1000000, 1000000],
  "qwen3.8-flash": [1000000, 1000000],
  "qwen3.7-max": [1000000, 1000000],
  "qwen3.7-plus": [1000000, 1000000],
  "qwen3.6-plus": [1000000, 1000000],
  "minimax-m3": [1048576, 1048576],
  "minimax-m2.7": [204800, 204800],
  "minimax-m2.5": [204800, 204800],
  "mimo-v2.5": [1050000, 1050000],
  "mimo-v2.5-pro": [1050000, 1050000],
  "hy4-preview": [1048576, 1048576],
  "hy3": [262144, 262144],
  "grok-4.6": [500000, 500000],
  "omen-alpha": [200000, 200000],
};

export function contextFor(id) {
  const [context_window, max_context_window] = CONTEXT[id] || [200000, 200000];
  return {
    context_window,
    max_context_window,
    auto_compact_token_limit: Math.floor(context_window * 0.9),
    effective_context_window_percent: 90,
  };
}
// Modelos listados no /models mas com upstream "Model is unavailable"
// (versoes superadas). Excluidos do catalogo gerado;
// para reativar, remova da lista (pode ser indisponibilidade temporaria).
export const UNAVAILABLE = [
  "kimi-k2.5",
  "glm-5",
  "mimo-v2-pro",
  "mimo-v2-omni",
  "hy3-preview",
  "grok-4.5",
  "qwen3.5-plus",
];
const DEEPSEEK = ["deepseek-v4.1-flash", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-flash", "deepseek-v4-flash-vision-exp"];
const KIMI_K3 = ["kimi-k3"];
const GLM = ["glm-5.3-flash", "glm-5.3", "glm-5.2", "glm-5.1", "glm-5"];

function threeSlot(off, mid, top, midLabel) {
  return {
    levels: [
      { effort: "low", description: `Desligado / direto (${off})` },
      { effort: "medium", description: midLabel || `Raciocinio intermediario (${mid})` },
      { effort: "high", description: `Raciocinio maximo (${top})` },
    ],
    map: { low: off, medium: mid, high: top, xhigh: top, max: top },
    def: "medium",
  };
}

function passthrough(def = "medium") {
  return {
    levels: [
      { effort: "low", description: "Respostas rapidas, raciocinio leve" },
      { effort: "medium", description: "Equilibrio entre velocidade e profundidade" },
      { effort: "high", description: "Raciocinio profundo p/ problemas complexos" },
    ],
    map: {},
    def,
  };
}

export function reasoningFor(id) {
  if (DEEPSEEK.includes(id)) return threeSlot("none", "high", "max");
  if (KIMI_K3.includes(id)) return threeSlot("low", "high", "max");
  if (GLM.includes(id)) return threeSlot("low", "high", "max");
  return passthrough();
}
