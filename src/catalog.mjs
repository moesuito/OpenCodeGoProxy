// Gera o model-catalog JSON do Codex a partir do /models live do Go,
// com overrides curados para os modelos problematicos.
// Uso: node src/catalog.mjs --print | node src/catalog.mjs --write <dest>
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { displayName, reasoningFor, isStrictUpstream, UNAVAILABLE } = await import("./model-meta.mjs");

function readCfg() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

const BASE_INSTRUCTIONS =
  "You are Codex, a coding agent working in the user's local workspace. Follow developer and user instructions, use the available tools when needed, and keep answers accurate and concise.";

function entryFor(id) {
  const strict = isStrictUpstream(id);
  const rz = reasoningFor(id);
  const e = {
    slug: id,
    display_name: displayName(id),
    description: `${displayName(id)} via OpenCode Go.`,
    base_instructions: BASE_INSTRUCTIONS,
    default_reasoning_level: rz.def,
    supported_reasoning_levels: rz.levels,
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    supports_parallel_tool_calls: false,
    priority: 1,
    additional_speed_tiers: [],
    service_tiers: [],
    availability_nux: null,
    upgrade: null,
    include_skills_usage_instructions: false,
    include_plugin_usage_instructions: false,
    include_apps_usage_instructions: false,
    supports_reasoning_summary_parameter: false,
    default_reasoning_summary: "none",
    support_verbosity: false,
    default_verbosity: null,
    web_search_tool_type: "text",
    truncation_policy: { mode: "tokens", limit: 10000 },
    supports_image_detail_original: true,
    context_window: 200000,
    max_context_window: 200000,
    auto_compact_token_limit: 180000,
    effective_context_window_percent: 90,
    experimental_supported_tools: [],
    input_modalities: ["text"],
    supports_search_tool: false,
    use_responses_lite: false,
    node_repl_auto_review_required: false,
    node_repl_disabled: true,
    tool_mode: "direct",
  };
  // So aplica freeform onde o upstream tolera `custom` (todos menos os strict).
  if (!strict) e.apply_patch_tool_type = "freeform";
  return e;
}

export async function generateCatalog(dest, key) {
  const cfg = readCfg();
  const UPSTREAM = (cfg.upstream || "https://opencode.ai/zen/go/v1").replace(/\/$/, "");
  const k = key || cfg.keys?.find((x) => x.key && !x.key.includes("COLE"))?.key || process.env.OPENCODE_API_KEY;
  if (!k) throw new Error("Sem API key: preencha config.json ou OPENCODE_API_KEY.");
  const r = await fetch(UPSTREAM + "/models", {
    headers: { authorization: `Bearer ${k}`, "user-agent": "OpenCodeGoProxy/0.1.0" },
  });
  if (!r.ok) throw new Error(`models -> ${r.status}`);
  const j = await r.json();
  const ids = (j.data || j.models || []).map((m) => m.id || m).filter(Boolean);
  const skipped = ids.filter((id) => UNAVAILABLE.includes(id));
  const live = ids.filter((id) => !UNAVAILABLE.includes(id));
  const catalog = { models: live.map(entryFor) };
  const out = JSON.stringify(catalog, null, 2) + "\n";
  fs.writeFileSync(dest, out);
  return { total: live.length, skipped, dest };
}

async function main() {
  const i = process.argv.indexOf("--write");
  if (i >= 0 && process.argv[i + 1]) {
    const r = await generateCatalog(process.argv[i + 1]);
    if (r.skipped.length) console.error(`excluidos (upstream indisponivel): ${r.skipped.join(", ")}`);
    console.log(`catalogo com ${r.total} modelos -> ${r.dest}`);
  } else {
    const r = await generateCatalog(process.argv[i + 1] || path.join(ROOT, "catalog.out.json"));
    console.log(`catalogo com ${r.total} modelos`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error("ERRO:", e.message);
    process.exit(1);
  });
}
