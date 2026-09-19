// API do painel: roda no processo MAIN (Node pleno). O renderer chama via IPC.
// Testavel headless: `node -e "import('./src/gui-api.mjs').then(...)"`
// com CODEX_HOME / OC_CLAUDE_DIR apontando p/ temp.
import fs from "node:fs";
import path from "node:path";
import {
  codexHome, getCodexState, activateProxy as cxOn, restoreNormal as cxOff,
} from "./profile-codex.mjs";
import {
  claudeDir, getClaudeState, activateProxy as clOn, restoreNormal as clOff,
} from "./profile-claude.mjs";
import { generateCatalog } from "./catalog.mjs";
import {
  loadSettings, saveSettings, isAutoStart, setAutoStart,
} from "./app-settings.mjs";
import { resolveConfigPath } from "./config-path.mjs";
import { NAMES, UNAVAILABLE } from "./model-meta.mjs";

function proxyConfig() {
  try {
    return JSON.parse(fs.readFileSync(resolveConfigPath(), "utf8"));
  } catch {
    return { port: 11447, keys: [] };
  }
}

function writeProxyConfig(patch) {
  const p = resolveConfigPath();
  const cur = proxyConfig();
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2));
  return proxyConfig();
}

const mask = (k) => (k && k.length > 8 ? k.slice(0, 6) + "…" + k.slice(-4) : "***");

export const api = {
  codexState: async () => getCodexState(),

  codexToggle: async () => {
    const st = getCodexState();
    if (st.active === "proxy") return { ...cxOff(), toggled: "normal" };
    const cfg = proxyConfig();
    const dest = path.join(codexHome(), "opencode-go-proxy-models.json");
    const key = cfg.keys?.find((k) => k.key && !k.key.includes("COLE"))?.key;
    await generateCatalog(dest, key);
    return { ...cxOn({ model: "deepseek-v4.1-flash", catalogPath: dest, port: cfg.port || 11447 }), toggled: "proxy" };
  },

  claudeState: async () => getClaudeState(undefined, proxyConfig().port || 11447),

  claudeToggle: async () => {
    const st = getClaudeState();
    if (st.active === "proxy") return { ...clOff(), toggled: "normal" };
    const cfg = proxyConfig();
    return { ...clOn({ port: cfg.port || 11447 }), toggled: "proxy" };
  },

  claudeModels: async () =>
    Object.entries(NAMES)
      .filter(([id]) => !UNAVAILABLE.includes(id))
      .map(([id, name]) => ({ id, name })),

  claudeTiers: async () => {
    const p = path.join(claudeDir(), "settings.json");
    const s = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      opus: s.env?.ANTHROPIC_DEFAULT_OPUS_MODEL || "",
      sonnet: s.env?.ANTHROPIC_MODEL || s.env?.ANTHROPIC_DEFAULT_SONNET_MODEL || "",
      haiku: s.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL || "",
    };
  },

  claudeTiersSet: async ({ opus, sonnet, haiku } = {}) => {
    const p = path.join(claudeDir(), "settings.json");
    try {
      const bak = p + ".bak-" + new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
      fs.copyFileSync(p, bak);
    } catch { /* segue */ }
    const s = JSON.parse(fs.readFileSync(p, "utf8"));
    s.env = s.env || {};
    if (opus) s.env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    if (sonnet) {
      s.env.ANTHROPIC_MODEL = sonnet;
      s.env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    }
    if (haiku) s.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
    return { ok: true };
  },

  sysGet: async () => ({ settings: loadSettings(), autoStartReal: await isAutoStart() }),

  sysSave: async ({ autoStart, startMinimized, exePath } = {}) => {
    saveSettings({ autoStart: !!autoStart, startMinimized: startMinimized !== false });
    await setAutoStart(!!autoStart, exePath, startMinimized !== false);
    return { settings: loadSettings(), autoStartReal: await isAutoStart() };
  },

  keysGet: async () => {
    const cfg = proxyConfig();
    return {
      port: cfg.port || 11447,
      keys: (cfg.keys || []).map((k) => ({ name: k.name, masked: mask(k.key), dayBudgetUsd: k.dayBudgetUsd })),
    };
  },

  keysSave: async ({ text } = {}) => {
    const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error("Cole ao menos uma key.");
    const keys = lines.map((l) => {
      const [name, key, day] = l.split("|");
      if (!name?.trim() || !key?.trim()) throw new Error(`Linha invalida (use nome|sk-...|orcamento): ${l.slice(0, 40)}`);
      return { name: name.trim(), key: key.trim(), dayBudgetUsd: day ? parseFloat(day) : undefined };
    });
    writeProxyConfig({ keys });
    return { saved: keys.length };
  },
};
