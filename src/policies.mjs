// Politicas por modelo: o que o proxy ajusta no request antes de encaminhar.
// Motivacao real: o upstream do Muse Spark (Console Go/Meta) rejeita
// schemas JSON recursivos ($ref ciclico, ex: GmailMessagePartRequest das
// tools do Gmail no Codex) e tools do tipo `custom` (apply_patch freeform).
// Outros upstreams (DeepSeek etc.) toleram — por isso funcionam direto.

const EFFORT_ORDER = ["none", "low", "medium", "high", "xhigh", "max"];

import { reasoningFor, isStrictUpstream } from "./model-meta.mjs";
import { SLIM_TOOLS } from "./anthropic-bridge.mjs";

function hasInternalRef(obj) {
  return JSON.stringify(obj).includes('"$ref"');
}

// Detecta ciclo: algum $defs referenciado que (transitivamente) referencia a si.
function isRecursiveSchema(params) {
  if (!params || typeof params !== "object") return false;
  const blob = JSON.stringify(params);
  if (!blob.includes("$ref")) return false;
  const defs = params.$defs || params.definitions || {};
  const refs = [...blob.matchAll(/"\$ref"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const internal = refs.filter((r) => r.startsWith("#/"));
  if (internal.length === 0) return false;
  // Heuristica conservadora: $ref interno + o albo referenciado contem $ref => trata como recursivo.
  for (const r of internal) {
    const name = r.split("/").pop();
    const def = defs[name];
    if (def && JSON.stringify(def).includes("$ref")) return true;
  }
  // Mesmo sem provar o ciclo, $ref interno ja quebra o Console Go — remove.
  return true;
}

function customToFunction(tool) {
  if (tool.name === "apply_patch") {
    // Estilo gpt-oss: function simples com um unico campo string. Nao-recursivo.
    return {
      type: "function",
      name: "apply_patch",
      description: tool.description || "Use the apply_patch tool to edit files",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "The entire contents of the apply_patch command" },
        },
        required: ["input"],
        additionalProperties: false,
      },
    };
  }
  return null; // custom desconhecido: remove (o upstream rejeitaria de qualquer forma)
}

function sanitizeTools(tools, model, opts = {}) {
  const dropped = [];
  let droppedChars = 0;
  const out = [];
  for (const t of tools || []) {
    // Strip dos conectores ChatGPT (codex_apps): namespaces enormes e com $ref
    // recursivo. Obrigatorio nos upstreams strict; opcional (economia de cota) nos demais.
    if (opts.stripCodexApps && t?.type === "namespace" && String(t?.name || "").startsWith("mcp__codex_apps__")) {
      dropped.push(`${t.name}:apps-strip`);
      droppedChars += JSON.stringify(t).length;
      continue;
    }
    if (t?.type === "custom") {
      const fn = customToFunction(t);
      if (fn) out.push(fn);
      else dropped.push(`${t?.name || "?"}:custom-nao-suportado`);
      continue;
    }
    if (t?.type === "namespace" && Array.isArray(t.tools)) {
      const kept = [];
      for (const sub of t.tools) {
        if (isRecursiveSchema(sub.parameters || sub.input_schema)) {
          dropped.push(`${t.name}/${sub.name || sub.function?.name}:schema-recursivo`);
        } else kept.push(sub);
      }
      if (kept.length === 0) {
        dropped.push(`${t.name}:namespace-vazio-apos-sanitizar`);
        continue;
      }
      out.push({ ...t, tools: kept });
      continue;
    }
    const schema = t?.parameters || t?.input_schema || t?.function?.parameters;
    if (isRecursiveSchema(schema)) {
      dropped.push(`${t?.name || "?"}:schema-recursivo`);
      continue;
    }
    out.push(t);
  }
  return { tools: out, dropped, droppedChars };
}

// Endpoint nativo de cada modelo na doc do Go (responses | chat | messages).
export function nativeEndpoint(model) {
  if (/^(muse-spark-.+|gpt-5.6-luna|grok-.+)$/.test(model)) return "responses";
  if (/^(minimax-.+|qwen3\..+)$/.test(model)) return "messages";
  return "chat";
}

export function sanitizeResponsesBody(body, model, policy) {
  const out = { ...body, model };
  const { tools, dropped, droppedChars } = sanitizeTools(body.tools, model, {
    stripCodexApps: policy.stripCodexApps,
  });
  out.tools = tools;
  if (typeof out.max_output_tokens === "number" && policy.maxOutputTokens) {
    out.max_output_tokens = Math.min(out.max_output_tokens, policy.maxOutputTokens);
  }
  if (out.reasoning) {
    // Traduz o slot do Codex p/ o effort nativo do modelo (ex: low -> none no DeepSeek).
    const map = reasoningFor(model).map;
    let effort = out.reasoning.effort;
    if (map[effort]) effort = map[effort];
    if (policy.maxReasoningEffort) {
      const cur = EFFORT_ORDER.indexOf(effort);
      const cap = EFFORT_ORDER.indexOf(policy.maxReasoningEffort);
      if (cur > cap) effort = policy.maxReasoningEffort;
    }
    out.reasoning = { ...out.reasoning, effort };
  }
  return { body: out, dropped, droppedChars };
}

export function modelPolicy(model, config) {
  const per = (config.models && config.models[model]) || {};
  return {
    enabled: per.enabled !== false,
    maxOutputTokens: per.maxOutputTokens ?? config.defaults?.maxOutputTokens ?? 8192,
    maxReasoningEffort: per.maxReasoningEffort ?? config.defaults?.maxReasoningEffort ?? "high",
    // Remove namespaces mcp__codex_apps__* (Gmail/GitHub/Drive...). Ordem:
    // per-model > defaults.stripCodexApps > true nos strict / false nos demais.
    stripCodexApps: per.stripCodexApps ?? config.defaults?.stripCodexApps ?? isStrictUpstream(model),
    // Bridge /messages -> /chat: "auto" (so p/ sem /messages nativo), "chat", "responses" ou false.
    bridge: per.bridge ?? config.defaults?.bridge ?? "auto",
    // Allowlist de tools na bridge (menos schemas = menos confusao + menos cota).
    // Default: lista enxuta nos strict (Muse), sem filtro nos demais.
    toolsAllow: per.toolsAllow ?? (isStrictUpstream(model) ? [...SLIM_TOOLS] : undefined),
    // Nudge anti-"DONE preguiçoso" nos strict (Muse): instrui a sempre agir via tools.
    nudgeTools: per.nudgeTools ?? isStrictUpstream(model),
  };
}
