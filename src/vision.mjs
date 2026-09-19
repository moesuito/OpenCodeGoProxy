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

export const DEFAULT_VISION_MODEL = "deepseek-v4-flash-vision-exp";

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

// Legenda via vision model (com cache por hash). Retorna {caption, usage, cached, cost}.
export async function describeImage(dataUrl, { key, upstream, sessionId, visionModel, maxTokens = 300, dataDir }) {
  const { estimateUsd } = await import("./prices.mjs");
  const model = visionModel || DEFAULT_VISION_MODEL;
  const hash = createHash("sha256").update(dataUrl).digest("hex").slice(0, 32);
  const cache = loadVisionCache(dataDir);
  if (cache[hash]) return { caption: cache[hash], usage: { input: 0, output: 0 }, cached: true, cost: 0, model };
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
          { type: "text", text: "Descreva esta imagem em detalhe, incluindo todo texto, letras, numeros e elementos visuais. Seja objetivo." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`vision model -> ${res.status}`);
  const j = await res.json();
  const caption = (j.choices?.[0]?.message?.content || "").trim() || "(imagem sem descricao)";
  const u = j.usage || {};
  const usage = { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 };
  cache[hash] = caption;
  saveVisionCache(dataDir, cache);
  return { caption, usage, cached: false, cost: estimateUsd(model, usage.input, usage.output), model };
}
