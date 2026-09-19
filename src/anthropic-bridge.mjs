// Bridge Anthropic Messages -> OpenAI Chat Completions (+ volta).
// Para modelos cujo endpoint nativo NAO e /messages (GLM, Kimi 2.x, MiMo,
// Hy, Muse, GPT Luna, Omen...). Inspirado no transformer do oc-go-cc
// (BindingOx, MIT) — implementacao propria, zero-deps.
// Modelos ja validados direto no /messages (passthrough, sem bridge):
export const PASSTHROUGH_MESSAGES = new Set([
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek-flash",
  "deepseek-v4-flash-vision-exp",
  "kimi-k3",
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.8-max",
  "qwen3.8-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
]);

export function needsBridge(model, policy) {
  return bridgeTarget(model, policy) !== false;
}

// false = passthrough /messages | "chat" = via /chat/completions | "responses" = via /responses
export function bridgeTarget(model, policy) {
  const per = policy?.bridge ?? "auto";
  if (per === false || per === "none") return false;
  if (per === "chat" || per === "responses") return per;
  if (PASSTHROUGH_MESSAGES.has(model)) return false;
  if (/^(muse-spark-.+|gpt-5.6-luna|grok-.+)$/.test(model)) return "responses";
  return "chat";
}

function textOf(blocks) {
  if (typeof blocks === "string") return blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b && (b.type === "text" || typeof b.text === "string"))
    .map((b) => b.text || "")
    .join("");
}

// --- Request: Anthropic -> Chat ---
export function translateMessagesRequest(a, policy = {}) {
  const out = { model: a.model, stream: a.stream === true, messages: [] };
  if (a.system) {
    const sys = textOf(a.system);
    if (sys) out.messages.push({ role: "system", content: sys });
  }
  for (const m of a.messages || []) {
    if (m.role === "tool" || m.role === "function") continue;
    if (m.role === "user") {
      const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }];
      const texts = [];
      for (const b of blocks) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text") texts.push(b.text || "");
        else if (b.type === "image" && (b.source?.type === "base64" || b.source?.type === "url")) {
          if (texts.join("")) {
            out.messages.push({ role: "user", content: texts.join("") });
            texts.length = 0;
          }
          const url =
            b.source.type === "base64"
              ? `data:${b.source.media_type};base64,${b.source.data}`
              : b.source.url;
          out.messages.push({ role: "user", content: [{ type: "image_url", image_url: { url } }] });
        }
        else if (b.type === "tool_result") {
          if (texts.join("")) {
            out.messages.push({ role: "user", content: texts.join("") });
            texts.length = 0;
          }
          out.messages.push({
            role: "tool",
            tool_call_id: b.tool_use_id,
            content: textOf(b.content) || (b.is_error ? "error" : ""),
          });
        }
      }
      if (texts.join("")) out.messages.push({ role: "user", content: texts.join("") });
      continue;
    }
    if (m.role === "assistant") {
      const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }];
      const text = textOf(blocks);
      const calls = blocks
        .filter((b) => b && b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      const msg = { role: "assistant", content: text || null };
      if (calls.length) msg.tool_calls = calls;
      if (msg.content !== null || calls.length) out.messages.push(msg);
      continue;
    }
  }
  if (Array.isArray(a.tools) && a.tools.length) {
    out.tools = a.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.input_schema || { type: "object" },
      },
    }));
    const tc = a.tool_choice;
    if (tc?.type === "auto" || tc === "auto") out.tool_choice = "auto";
    else if (tc?.type === "any") out.tool_choice = "required";
    else if (tc?.type === "tool" && tc.name)
      out.tool_choice = { type: "function", function: { name: tc.name } };
    else if (tc?.type === "none") out.tool_choice = "none";
  }
  if (typeof a.max_tokens === "number") out.max_tokens = a.max_tokens;
  if (policy.maxOutputTokens && (!out.max_tokens || out.max_tokens > policy.maxOutputTokens))
    out.max_tokens = policy.maxOutputTokens;
  if (typeof a.temperature === "number") out.temperature = a.temperature;
  if (typeof a.top_p === "number") out.top_p = a.top_p;
  if (Array.isArray(a.stop_sequences) && a.stop_sequences.length) out.stop = a.stop_sequences;
  if (out.stream) out.stream_options = { include_usage: true };
  return out;
}

// --- Response: Chat -> Anthropic (nao-streaming) ---
export function mapStopReason(fr) {
  if (fr === "tool_calls") return "tool_use";
  if (fr === "length") return "max_tokens";
  return "end_turn";
}

export function translateChatResponse(c, model) {
  const choice = c?.choices?.[0] || {};
  const msg = choice.message || {};
  const blocks = [];
  for (const tc of msg.tool_calls || []) {
    let input = {};
    try {
      input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      input = {};
    }
    blocks.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
  }
  const text = typeof msg.content === "string" ? msg.content : "";
  if (text) blocks.push({ type: "text", text });
  if (!blocks.length) blocks.push({ type: "text", text: "" });
  const u = c.usage || {};
  return {
    id: c.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content: blocks,
    stop_reason: mapStopReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: u.prompt_tokens || 0,
      output_tokens: u.completion_tokens || 0,
      ...(u.prompt_tokens_details?.cached_tokens
        ? { cache_read_input_tokens: u.prompt_tokens_details.cached_tokens }
        : {}),
    },
  };
}

export function anthropicError(status, message) {
  const type =
    status === 400 ? "invalid_request_error"
    : status === 401 ? "authentication_error"
    : status === 403 ? "permission_error"
    : status === 404 ? "not_found_error"
    : status === 429 ? "rate_limit_error"
    : "api_error";
  return { type: "error", error: { type, message: String(message || "upstream error").slice(0, 500) } };
}

// --- Request: Anthropic -> Responses (p/ modelos responses-native: Muse, GPT Luna, Grok) ---
export function translateMessagesToResponses(a, policy = {}) {
  const input = [];
  for (const m of a.messages || []) {
    const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }];
    if (m.role === "user") {
      const texts = [];
      const flush = () => {
        if (texts.join("")) {
          input.push({ type: "message", role: "user", content: [{ type: "input_text", text: texts.join("") }] });
          texts.length = 0;
        }
      };
      for (const b of blocks) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text") texts.push(b.text || "");
        else if (b.type === "image")
          texts.push(b.source?.type === "url" ? `[imagem: ${b.source.url}]` : "[imagem]");
        else if (b.type === "tool_result") {
          flush();
          input.push({
            type: "function_call_output",
            call_id: b.tool_use_id,
            output: textOf(b.content) || "",
          });
        }
      }
      flush();
      continue;
    }
    if (m.role === "assistant") {
      const texts = [];
      for (const b of blocks) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text") texts.push(b.text || "");
        else if (b.type === "tool_use") {
          if (texts.join("")) {
            input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: texts.join("") }] });
            texts.length = 0;
          }
          input.push({
            type: "function_call",
            call_id: b.id,
            name: b.name,
            arguments: JSON.stringify(b.input ?? {}),
          });
        }
      }
      if (texts.join(""))
        input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: texts.join("") }] });
      continue;
    }
  }
  const out = { model: a.model, input, stream: a.stream === true };
  const sys = textOf(a.system);
  if (sys) out.instructions = sys;
  if (Array.isArray(a.tools) && a.tools.length) {
    out.tools = a.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema || { type: "object" },
      strict: false,
    }));
    const tc = a.tool_choice;
    if (tc?.type === "any") out.tool_choice = "required";
    else if (tc?.type === "none") out.tool_choice = "none";
    else if (tc?.type === "tool" && tc.name) out.tool_choice = { type: "function", name: tc.name };
    else out.tool_choice = "auto";
  }
  const cap = policy.maxOutputTokens || 8192;
  out.max_output_tokens = typeof a.max_tokens === "number" ? Math.min(a.max_tokens, cap) : cap;
  if (typeof a.temperature === "number") out.temperature = a.temperature;
  if (typeof a.top_p === "number") out.top_p = a.top_p;
  return out;
}

// --- Response: Responses -> Anthropic (nao-streaming) ---
export function translateResponsesResponse(r, model) {
  const blocks = [];
  for (const item of r.output || []) {
    if (item.type === "message") {
      const text = (item.content || [])
        .filter((c) => c.type === "output_text")
        .map((c) => c.text || "")
        .join("");
      if (text) blocks.push({ type: "text", text });
    } else if (item.type === "function_call") {
      let input = {};
      try {
        input = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        input = {};
      }
      blocks.push({ type: "tool_use", id: item.call_id || item.id, name: item.name, input });
    }
  }
  if (!blocks.length) blocks.push({ type: "text", text: "" });
  const incomplete = r.status === "incomplete";
  const u = r.usage || {};
  return {
    id: r.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content: blocks,
    stop_reason: incomplete ? "max_tokens" : blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0 },
  };
}

// --- Streaming: Responses SSE -> Anthropic SSE ---
export function createResponsesToAnthropicStream() {
  const st = {
    started: false, msgId: `msg_${Date.now()}`, model: "",
    nextIndex: 0, textIndex: -1, openBlocks: new Set(),
    items: new Map(), // item_id -> {order, name, callId, buf, started}
    usage: { input: 0, output: 0 }, stopReason: "end_turn",
  };
  const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const ensureStart = (model) => {
    if (st.started) return "";
    st.started = true;
    st.model = model;
    return sse("message_start", {
      type: "message_start",
      message: { id: st.msgId, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
    });
  };
  const openText = () => {
    if (st.textIndex !== -1) return "";
    st.textIndex = st.nextIndex++;
    st.openBlocks.add(st.textIndex);
    return sse("content_block_start", { type: "content_block_start", index: st.textIndex, content_block: { type: "text", text: "" } });
  };
  const closeBlock = (i) => {
    if (!st.openBlocks.has(i)) return "";
    st.openBlocks.delete(i);
    return sse("content_block_stop", { type: "content_block_stop", index: i });
  };
  const startTool = (it) => {
    if (it.started) return "";
    it.started = true;
    it.order = st.nextIndex++;
    st.openBlocks.add(it.order);
    return sse("content_block_start", {
      type: "content_block_start", index: it.order,
      content_block: { type: "tool_use", id: it.callId || it.id, name: it.name || "", input: {} },
    });
  };

  function push(eventType, data, model) {
    let out = ensureStart(model);
    const type = eventType || data.type || "";
    if (type === "response.created" && data.response) {
      if (data.response.id) st.msgId = data.response.id;
    } else if (type === "response.output_text.delta") {
      const itemId = data.item_id || "text";
      if (itemId !== "text" && st.items.has(itemId)) out += closeBlock(st.textIndex);
      out += openText();
      if (data.delta) out += sse("content_block_delta", { type: "content_block_delta", index: st.textIndex, delta: { type: "text_delta", text: data.delta } });
    } else if (type === "response.output_item.added" && data.item?.type === "function_call") {
      const it = data.item;
      st.items.set(it.id, { id: it.id, name: it.name || "", callId: it.call_id || "", buf: "", started: false, order: -1 });
    } else if (type === "response.function_call_arguments.delta") {
      const it = st.items.get(data.item_id) || { id: data.item_id, name: "", callId: "", buf: "", started: false, order: -1 };
      if (!st.items.has(data.item_id)) st.items.set(data.item_id, it);
      it.buf += data.delta || "";
      if (it.name) {
        out += startTool(it);
        if (data.delta) out += sse("content_block_delta", { type: "content_block_delta", index: it.order, delta: { type: "input_json_delta", partial_json: data.delta } });
      }
    } else if (type === "response.output_item.done" && data.item?.type === "function_call") {
      let it = st.items.get(data.item.id);
      if (!it) {
        it = { id: data.item.id, name: data.item.name || "", callId: data.item.call_id || "", buf: data.item.arguments || "", started: false, order: -1 };
        st.items.set(data.item.id, it);
      } else {
        it.name = it.name || data.item.name || "";
        it.callId = it.callId || data.item.call_id || "";
        it.buf = data.item.arguments ?? it.buf;
      }
      out += startTool(it);
      // Se os deltas chegaram antes do nome, reemite o buffer agora.
      if (it.buf && !it.flushed) {
        out += sse("content_block_delta", { type: "content_block_delta", index: it.order, delta: { type: "input_json_delta", partial_json: it.buf } });
      }
      it.flushed = true;
      out += closeBlock(it.order);
    } else if (type === "response.completed" && data.response) {
      const u = data.response.usage || {};
      st.usage.input = u.input_tokens || 0;
      st.usage.output = u.output_tokens || 0;
      if (data.response.status === "incomplete") st.stopReason = "max_tokens";
    } else if (type === "response.failed" || type === "response.incomplete") {
      st.stopReason = "max_tokens";
    }
    return out;
  }

  function finish() {
    let out = "";
    for (const i of [...st.openBlocks]) out += closeBlock(i);
    if (st.stopReason === "end_turn") {
      for (const it of st.items.values()) if (it.started) { st.stopReason = "tool_use"; break; }
    }
    out += sse("message_delta", { type: "message_delta", delta: { stop_reason: st.stopReason, stop_sequence: null }, usage: { input_tokens: st.usage.input, output_tokens: st.usage.output } });
    out += sse("message_stop", { type: "message_stop", usage: st.usage });
    return { sse: out, usage: st.usage, stopReason: st.stopReason };
  }

  return { push, finish };
}
// --- Streaming: Chat SSE -> Anthropic SSE ---
export function createChatToAnthropicStream() {
  const state = {
    started: false,
    msgId: `msg_${Date.now()}`,
    model: "",
    nextIndex: 0,
    textIndex: -1,
    toolIndexByOrder: new Map(), // chat index -> anthropic block index
    openBlocks: new Set(),
    usage: { input: 0, output: 0 },
    stopReason: "end_turn",
  };
  const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  function ensureStart(model) {
    if (state.started) return "";
    state.started = true;
    state.model = model;
    return sse("message_start", {
      type: "message_start",
      message: {
        id: state.msgId, type: "message", role: "assistant", model,
        content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  function openText() {
    let out = "";
    if (state.textIndex === -1) {
      state.textIndex = state.nextIndex++;
      state.openBlocks.add(state.textIndex);
      out += sse("content_block_start", {
        type: "content_block_start", index: state.textIndex,
        content_block: { type: "text", text: "" },
      });
    }
    return out;
  }

  function closeBlock(i) {
    if (!state.openBlocks.has(i)) return "";
    state.openBlocks.delete(i);
    return sse("content_block_stop", { type: "content_block_stop", index: i });
  }

  function push(chunk, model) {
    let out = ensureStart(model);
    const choice = chunk?.choices?.[0] || {};
    const delta = choice.delta || {};
    if (typeof delta.content === "string" && delta.content) {
      out += openText();
      out += sse("content_block_delta", {
        type: "content_block_delta", index: state.textIndex,
        delta: { type: "text_delta", text: delta.content },
      });
    }
    for (const tc of delta.tool_calls || []) {
      const order = tc.index ?? 0;
      if (!state.toolIndexByOrder.has(order)) {
        if (state.textIndex !== -1) out += closeBlock(state.textIndex);
        const bi = state.nextIndex++;
        state.toolIndexByOrder.set(order, bi);
        state.openBlocks.add(bi);
        out += sse("content_block_start", {
          type: "content_block_start", index: bi,
          content_block: { type: "tool_use", id: tc.id || "", name: tc.function?.name || "", input: {} },
        });
      }
      const bi = state.toolIndexByOrder.get(order);
      const args = tc.function?.arguments;
      if (args) {
        out += sse("content_block_delta", {
          type: "content_block_delta", index: bi,
          delta: { type: "input_json_delta", partial_json: args },
        });
      }
    }
    if (choice.finish_reason) state.stopReason = mapStopReason(choice.finish_reason);
    if (chunk.usage) {
      state.usage.input = chunk.usage.prompt_tokens || 0;
      state.usage.output = chunk.usage.completion_tokens || 0;
    }
    return out;
  }

  function finish() {
    let out = "";
    for (const i of [...state.openBlocks]) out += closeBlock(i);
    out += sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: state.stopReason, stop_sequence: null },
      usage: { input_tokens: state.usage.input, output_tokens: state.usage.output },
    });
    out += sse("message_stop", { type: "message_stop", usage: state.usage });
    return { sse: out, usage: state.usage, stopReason: state.stopReason };
  }

  return { push, finish, state };
}
