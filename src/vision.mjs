// Image decoder: modelos comprovadamente cegos recebem a legenda textual
// da imagem (gerada pelo vision model) no lugar do bloco de imagem.
// Evidencia (quiz "letra S", 2026-09-19):
//   VEM de fabrica: vision-exp, glm-5.3-flash, deepseek-v4.1-flash,
//     deepseek-v4-pro, gpt-5.6-luna, kimi-k3, mimo-v2.5, minimax-*, qwen*
//   CEGOS: muse-spark-1.2/1.3 (queima budget sem responder), kimi-k2.6 (vazio),
//     glm-5.3 (rejeita explicito: "does not support image")
//   Demais: passthrough (adicione aqui conforme validar).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SRC_DIR);

export const NEEDS_DECODER = new Set([
  "muse-spark-1.3-contributor",
  "muse-spark-1.2-contributor",
  "kimi-k2.6",
  "glm-5.3",
  "glm-5.2",
  "glm-5.1",
  "glm-5",
]);

export const DEFAULT_VISION_MODEL = "glm-5.3-flash";
// Modelos com visao nativa comprovada (p/ o seletor da UI). Precos in/out por 1M.
export const VISION_MODELS = [
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", in: 0.15, out: 0.5 },
  { id: "mimo-v2.5", name: "MiMo V2.5", in: 0.14, out: 0.28 },
  { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision", in: 0.15, out: 0.6 },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", in: 0.15, out: 0.6 },
  { id: "kimi-k3", name: "Kimi K3", in: 3.0, out: 15.0 },
  { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", in: 0.2, out: 1.2 },
];
// Chain: o selecionado primeiro, depois os demais (baratos antes do Kimi).
export function buildChain(primary) {
  const first = primary || DEFAULT_VISION_MODEL;
  return [first, ...VISION_MODELS.map((m) => m.id).filter((id) => id !== first)];
}

export const VISION_UNAVAILABLE_TEXT =
  "anexo de imagem indisponivel para analise automatica — peca ao usuario que descreva o conteudo";

// System prompt do legendador: ele e os OLHOS de um agente de codigo.
// A legenda precisa ser acionavel: textos exatos, elementos, estados, layout.
export const CAPTION_PROMPT = `Voce e o modulo de visao de um agente de programacao. O modelo principal NAO ve pixels: sua descricao e TUDO que ele sabera da imagem. Seja fiel e estruturado.

1. Primeiro diga o TIPO: screenshot de interface (app/web/IDE/terminal), foto de erro, trecho de codigo, diagrama/grafico, documento ou foto comum.
2. INTERFACE: liste elementos interativos visiveis (botoes, campos, menus, abas, checkboxes) com rotulos EXATOS e estado (marcado, desabilitado, selecionado) + posicao aproximada (topo, esquerda, centro...).
3. ERROS/TERMINAL: transcreva mensagens de erro, codigos, paths de arquivo e stack traces INTEGRALMENTE, sem resumir. Separe o que foi comando digitado do que e saida.
4. CODIGO: transcreva o trecho fielmente (linguagem, nomes de funcao/variavel).
5. TEXTO EM GERAL: transcreva literalmente; se algo estiver ilegivel/cortado, diga "ilegivel" em vez de adivinhar. NUNCA invente conteudo.
6. LAYOUT: descreva organizacao espacial (o que esta ao lado/acima/abaixo do que). Cor so quando relevante.`;

function cachePath(dataDir) {
  return path.join(dataDir, "vision-cache.json");
}

export function loadVisionCache(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(cachePath(dataDir), "utf8"));
  } catch {
    return {};
  }
}

export function saveVisionCache(dataDir, c) {
  const keys = Object.keys(c);
  while (keys.length > 500) delete c[keys.shift()];
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(cachePath(dataDir), JSON.stringify(c));
}

export function shouldDecode(model, policy) {
  const v = policy?.vision ?? "auto";
  if (v === false || v === "off" || v === "never") return false;
  if (v === true || v === "always") return true;
  return NEEDS_DECODER.has(model); // auto
}

// Texto do usuario junto da imagem (p/ legenda focada na pergunta, nao generica).
export function surroundingText(body, max = 500) {
  const texts = [];
  const visit = (node, role) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((it) => visit(it, role));
      return;
    }
    if (node.role === "user" || node.role === "assistant") role = node.role;
    if (role === "user") {
      if (node.type === "input_text" && node.text) texts.push(node.text);
      if (node.type === "text" && node.text) texts.push(node.text);
    }
    for (const v of Object.values(node)) visit(v, role);
  };
  visit(body, null);
  return texts.join("\n").slice(0, max);
}
// Localiza blocos de imagem (3 formatos) e retorna {node, parent, key} p/ troca in-place.
export function findImages(body) {
  const found = [];
  const visit = (node, parent, key) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((it, i) => visit(it, node, i));
      return;
    }
    if (node.type === "input_image" && typeof node.image_url === "string" && node.image_url.startsWith("data:")) {
      found.push({ kind: "responses", node, parent, key });
      return;
    }
    if (node.type === "image_url" && node.image_url?.url?.startsWith?.("data:")) {
      found.push({ kind: "chat", node, parent, key });
      return;
    }
    if (node.type === "image" && node.source?.type === "base64" && node.source?.data) {
      found.push({ kind: "messages", node, parent, key });
      return;
    }
    for (const [k, v] of Object.entries(node)) visit(v, node, k);
  };
  visit(body, null, null);
  return found;
}

export function dataUrlOf(found) {
  if (found.kind === "responses") return found.node.image_url;
  if (found.kind === "chat") return found.node.image_url.url;
  const s = found.node.source;
  return `data:${s.media_type};base64,${s.data}`;
}

export function replaceWithCaption(found, caption, idx) {
  const text = `[imagem ${idx}: ${caption}]`;
  let node;
  if (found.kind === "responses") node = { type: "input_text", text };
  else if (found.kind === "chat") node = { type: "text", text };
  else node = { type: "text", text };
  if (found.parent && found.key !== null && found.key !== undefined) found.parent[found.key] = node;
}

// Legenda via chain de vision models (com cache por hash).
// Retorna {caption, usage, cached, cost, model, attempts:[{model,input,output}]}.
// Vazios NUNCA entram no cache. Se tudo falhar, caption = null.
export async function describeImage(dataUrl, { key, upstream, sessionId, visionModel, maxTokens = 500, dataDir, hint }) {
  const { estimateUsd } = await import("./prices.mjs");
  const chain = buildChain(visionModel);
  const hash = createHash("sha256").update(dataUrl).digest("hex").slice(0, 32);
  const cache = loadVisionCache(dataDir);
  if (cache[hash]) return { caption: cache[hash], usage: { input: 0, output: 0 }, cached: true, cost: 0, model: chain[0], attempts: [] };
  const attempts = [];
  for (const model of chain) {
    try {
      const res = await fetch(`${upstream}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "x-opencode-session": sessionId,
          "user-agent": "OpenCodeGoProxy/0.1.0",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          stream: false,
          messages: [{
          role: "user",
          content: [
            { type: "text", text: CAPTION_PROMPT + (hint ? `\n\nContexto da pergunta do usuario (foque no que e relevante para ela): ${hint}` : "") },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
          }],
        }),
      });
      if (!res.ok) throw new Error(`${model} -> ${res.status}`);
      const j = await res.json();
      const raw = j.choices?.[0]?.message?.content;
      const text = (Array.isArray(raw) ? raw.map((c) => (typeof c === "string" ? c : c?.text || "")).join("") : String(raw || "")).trim();
      const u = j.usage || {};
      attempts.push({ model, input: u.prompt_tokens || 0, output: u.completion_tokens || 0 });
      // Gate de qualidade: fragmento curto = truncado/inutil -> tenta o proximo.
      if (text && text.length >= 80) {
        cache[hash] = text;
        saveVisionCache(dataDir, cache);
        const last = attempts[attempts.length - 1];
        return { caption: text, usage: { input: last.input, output: last.output }, cached: false, cost: estimateUsd(model, last.input, last.output), model, attempts };
      }
    } catch (e) {
      attempts.push({ model, input: 0, output: 0, error: String(e.message || e).slice(0, 120) });
    }
  }
  return { caption: null, usage: { input: 0, output: 0 }, cached: false, cost: 0, model: chain[0], attempts };
}
