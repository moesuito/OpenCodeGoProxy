#!/usr/bin/env node
// OpenCodeGoProxy: proxy local zero-dependencias.
// Codex (Responses) -> POST /v1/responses
// Codex/OpenAI-compat (Chat) -> POST /v1/chat/completions
// Claude Code (Anthropic)   -> POST /v1/messages
// Catalogo                  -> GET  /v1/models
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { KeyPool, loadLedger } from "./keypool.mjs";
import { sanitizeResponsesBody, modelPolicy } from "./policies.mjs";
import { estimateUsd } from "./prices.mjs";
import { resolveConfigPath, dataDirFor } from "./config-path.mjs";
import {
  bridgeTarget,
  translateMessagesRequest,
  translateMessagesToResponses,
  translateChatResponse,
  translateResponsesResponse,
  createChatToAnthropicStream,
  createResponsesToAnthropicStream,
  anthropicError,
} from "./anthropic-bridge.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG_PATH = resolveConfigPath();
const DATA_DIR = dataDirFor(CONFIG_PATH);
const USAGE_LOG = path.join(DATA_DIR, "usage.jsonl");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    // Primeira execucao no app instalado: materializa config editavel no APPDATA.
    const example = path.join(ROOT, "config.example.json");
    if (CONFIG_PATH !== path.join(ROOT, "config.json") && fs.existsSync(example)) {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.copyFileSync(example, CONFIG_PATH);
      throw new Error(
        `Config criado em ${CONFIG_PATH}. Abra o painel, preencha sua(s) API key(s) e reinicie.`
      );
    }
    throw new Error(`Falta ${CONFIG_PATH}. Copie config.example.json para config.json e preencha suas keys.`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

const config = loadConfig();
const UPSTREAM = (config.upstream || "https://opencode.ai/zen/go/v1").replace(/\/$/, "");
const PORT = process.env.OPENCODE_GO_PROXY_PORT || config.port || 11447;
const pool = new KeyPool(config.keys);
let modelsCache = { at: 0, body: null };

function logUsage(entry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(USAGE_LOG, JSON.stringify(entry) + "\n");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Extrai usage de JSON final ou de SSE (melhor esforço, últimos 64KB).
function extractUsage(buf, model) {
  const tail = buf.slice(-65536).toString("utf8");
  const pick = (re) => {
    const m = tail.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  const input =
    pick(/"(?:input_tokens|prompt_tokens)"\s*:\s*(\d+)/) ||
    [...tail.matchAll(/"input_tokens"\s*:\s*(\d+)/g)].map((m) => +m[1]).pop() || 0;
  const output =
    pick(/"(?:output_tokens|completion_tokens)"\s*:\s*(\d+)/) ||
    [...tail.matchAll(/"output_tokens"\s*:\s*(\d+)/g)].map((m) => +m[1]).pop() || 0;
  return { input, output };
}

async function forward(upPath, clientBody, clientHeaders, opts = {}) {
  const tried = new Set();
  let lastErr = null;
  while (true) {
    const entry = pool.next(tried);
    if (!entry) break;
    tried.add(entry.name);
    const headers = {};
    for (const [k, v] of Object.entries(clientHeaders || {})) {
      const kl = k.toLowerCase();
      if (["host", "content-length", "connection", "content-type", "authorization"].includes(kl)) continue;
      headers[kl] = v;
    }
    if (!headers["x-opencode-session"] && !headers["X-Opencode-Session"]) {
      headers["x-opencode-session"] = randomUUID();
    }
    const GENERIC_UA = /python-urllib|curl|wget|libcurl|axios|node-fetch|undici|go-http|powershell/i;
    const incomingUa = headers["user-agent"];
    if (!incomingUa || GENERIC_UA.test(incomingUa)) {
      headers["user-agent"] = "OpenCodeGoProxy/0.1.0";
    }
    headers["authorization"] = `Bearer ${entry.key}`;
    if (opts.keyHeader) headers[opts.keyHeader] = entry.key;
    headers["content-type"] = "application/json";
    try {
      const res = await fetch(UPSTREAM + upPath, {
        method: "POST",
        headers,
        body: typeof clientBody === "string" ? clientBody : JSON.stringify(clientBody),
      });
      if ((res.status === 429 || res.status >= 500) && pool.next(tried)) {
        pool.advance();
        lastErr = `upstream ${res.status}, tentando proxima key`;
        continue;
      }
      return { res, entry };
    } catch (e) {
      lastErr = String(e?.message || e);
      if (!pool.next(tried)) break;
    }
  }
  throw new Error(lastErr || "sem keys disponiveis (orcamento esgotado?)");
}

// POST /messages com bridge: Anthropic -> /chat ou /responses -> Anthropic.
async function handleBridgedMessages(req, res, aBody, model, policy, reqPath, target) {
  const toResponses = target === "responses";
  const upBody =
    toResponses ? translateMessagesToResponses(aBody, policy) : translateMessagesRequest(aBody, policy);
  const wantStream = aBody.stream === true;
  upBody.stream = wantStream;
  if (wantStream && !toResponses) upBody.stream_options = { include_usage: true };
  let up, entry;
  try {
    ({ res: up, entry } = await forward(toResponses ? "/responses" : "/chat/completions", upBody, req.headers, {}));
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify(anthropicError(502, e?.message)));
    return;
  }
  const finish = (input, output, status, errText) => {
    const usd = pool.record(entry, model, input, output) || estimateUsd(model, input, output);
    logUsage({
      at: new Date().toISOString(), key: entry.name, model, path: reqPath,
      status, input_tokens: input, output_tokens: output, usd_estimate: usd,
      bridged: true,
      ...(errText ? { upstream_error: errText } : {}),
    });
    pool.advance();
  };
  if (!up.ok) {
    const text = await up.text().catch(() => "");
    res.writeHead(up.status, { "content-type": "application/json" });
    res.end(JSON.stringify(anthropicError(up.status, text)));
    finish(0, 0, up.status, text.slice(0, 300));
    return;
  }
  if (!wantStream) {
    const j = await up.json().catch(() => null);
    if (!j) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify(anthropicError(502, "resposta invalida do upstream")));
      finish(0, 0, 502);
      return;
    }
    const a = toResponses ? translateResponsesResponse(j, model) : translateChatResponse(j, model);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(a));
    finish(a.usage.input_tokens, a.usage.output_tokens, 200);
    return;
  }
  // Streaming: traduz SSE -> SSE Anthropic em tempo real.
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const tr = toResponses ? createResponsesToAnthropicStream() : createChatToAnthropicStream();
  const reader = up.body.getReader();
  const dec = new TextDecoder();
  let sseBuf = "";
  const flush = () => {
    const parts = sseBuf.split("\n\n");
    sseBuf = parts.pop();
    for (const part of parts) {
      let event = null;
      for (const line of part.split("\n")) {
        const t = line.trim();
        if (t.startsWith("event:")) event = t.slice(6).trim();
        else if (t.startsWith("data:")) {
          const payload = t.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            res.write(toResponses ? tr.push(event, JSON.parse(payload), model) : tr.push(JSON.parse(payload), model));
          } catch { /* chunk parcial: ignora */ }
        }
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuf += dec.decode(value, { stream: true });
      flush();
    }
    flush();
  } catch { /* conexao caiu: encerra graciosamente */ }
  const end = tr.finish();
  res.write(end.sse);
  res.end();
  finish(end.usage.input, end.usage.output, 200);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, upstream: UPSTREAM, keys: pool.keys.map((k) => k.name) }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/stats") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ledger: loadLedger(), prices: "ver src/prices.mjs; console oficial vale como verdade" }));
      return;
    }
    // Aceita com ou sem prefixo /v1 (Codex usa base_url + /responses direto).
    const p = url.pathname.replace(/^\/v1\//, "/");
    if (req.method === "GET" && (p === "/models" || url.pathname === "/v1/models")) {
      if (Date.now() - modelsCache.at < 3600e3 && modelsCache.body) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(modelsCache.body);
        return;
      }
      const entry = pool.next();
      const r = await fetch(UPSTREAM + "/models", {
        headers: { authorization: `Bearer ${entry.key}`, "user-agent": "OpenCodeGoProxy/0.1.0" },
      });
      const body = await r.text();
      if (r.ok) modelsCache = { at: Date.now(), body };
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    if (req.method === "POST" && ["/responses", "/chat/completions", "/messages"].includes(p)) {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "body precisa ser JSON" }));
        return;
      }
      const model = body.model || "";
      const policy = modelPolicy(model, config);
      if (!policy.enabled) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `modelo ${model} desabilitado no config.json (trava de cota)` }));
        return;
      }
      let upPath = "/chat/completions";
      let dropped = [];
      let droppedChars = 0;
      if (p === "/responses") {
        upPath = "/responses";
        const s = sanitizeResponsesBody(body, model, policy);
        body = s.body;
        dropped = s.dropped;
        droppedChars = s.droppedChars || 0;
      } else if (p === "/messages") {
        upPath = "/messages";
        // Bridge p/ modelos sem /messages nativo (traduz p/ /chat e de volta).
        if (bridgeTarget(model, policy)) {
          await handleBridgedMessages(req, res, body, model, policy, url.pathname, bridgeTarget(model, policy));
          return;
        }
      } else if (typeof body.max_tokens === "number" && policy.maxOutputTokens) {
        body.max_tokens = Math.min(body.max_tokens, policy.maxOutputTokens);
      }
      const { res: up, entry } = await forward(upPath, body, req.headers, {
        keyHeader: p === "/messages" ? "x-api-key" : undefined,
      });
      const buf = Buffer.from(await up.arrayBuffer());
      if (process.env.OPENCODE_GO_PROXY_DUMP === "1") {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, `dump-${id}-req.json`), JSON.stringify({ model, path: url.pathname, dropped, body }, null, 1).slice(0, 200000));
        fs.writeFileSync(path.join(DATA_DIR, `dump-${id}-res.bin`), buf.slice(0, 500000));
        console.log(`[dump] ${id} (${model}, ${dropped.length} drops)`);
      }
      const { input, output } = extractUsage(buf, model);
      const usd = pool.record(entry, model, input, output) || estimateUsd(model, input, output);
      logUsage({
        at: new Date().toISOString(),
        key: entry.name,
        model,
        path: url.pathname,
        status: up.status,
        input_tokens: input,
        output_tokens: output,
        usd_estimate: usd,
        sanitized_dropped: dropped,
        approx_input_tokens_saved: Math.round(droppedChars / 4),
      });
      if (dropped.length)
        console.log(
          `[${model}] sanitizado (${Math.round(droppedChars / 4)} tokens poupados): ${dropped.join("; ")}`
        );
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" });
      res.end(buf);
      pool.advance();
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "rota desconhecida" }));
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`OpenCodeGoProxy ouvindo em http://127.0.0.1:${PORT}`);
  console.log(`Upstream: ${UPSTREAM} | keys: ${pool.keys.map((k) => k.name).join(", ")}`);
});

export function stopProxy() {
  return new Promise((resolve) => server.close(resolve));
}
