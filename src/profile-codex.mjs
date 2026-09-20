// Switch de profile do Codex: Normal <-> OpenCodeGoProxy.
// Backup em config.toml.pre-oc-gui (+ timestamped). Nunca perde o original.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}
const cfgPath = (home) => path.join(home || codexHome(), "config.toml");
const prevPath = (home) => path.join(home || codexHome(), "config.toml.pre-oc-gui");
const legacyPrevPath = (home) => path.join(home || codexHome(), "config.toml.pre-oc-proxy");
export const PROXY_PROVIDER = "opencode_go_proxy";

function read(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function topLevel(toml, key) {
  const m = toml.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
  if (!m) return undefined;
  const v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function setTopLevel(src, key, value) {
  const re = new RegExp(`^${key}\\s*=.*$`, "m");
  if (re.test(src)) return src.replace(re, `${key} = ${value}`);
  return `${key} = ${value}\n${src}`;
}

export function getCodexState(home) {
  const toml = read(cfgPath(home));
  const provider = topLevel(toml, "model_provider");
  const model = topLevel(toml, "model");
  const active = provider === PROXY_PROVIDER ? "proxy" : "normal";
  return { active, provider, model, hasBackup: fs.existsSync(prevPath(home)) || fs.existsSync(legacyPrevPath(home)) };
}

export function ensureProvider(home, port) {
  const p = cfgPath(home);
  let toml = read(p);
  if (!toml.includes("[model_providers.opencode_go_proxy]")) {
    backup(p, home);
    if (toml.length && !toml.endsWith("\n")) toml += "\n";
    toml += `\n[model_providers.opencode_go_proxy]\nname = "OpenCodeGoProxy"\nbase_url = "http://127.0.0.1:${port}"\nenv_key = "OPENCODE_GO_PROXY_KEY"\nwire_api = "responses"\n`;
    fs.writeFileSync(p, toml);
  }
}

export function backup(p, home) {
  if (!fs.existsSync(p)) return null;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
  const b = `${p}.bak-${stamp}`;
  fs.copyFileSync(p, b);
  return b;
}

// Ativa o proxy como padrao (CLI + App usam o mesmo config base).
export function activateProxy({ home, model, catalogPath, port } = {}) {
  const h = home || codexHome();
  const p = cfgPath(h);
  let toml = read(p);
  const st = getCodexState(h);
  if (st.active === "proxy" && (!model || st.model === model)) return { already: true, ...st };
  backup(p, h);
  if (!fs.existsSync(prevPath(h))) fs.copyFileSync(p, prevPath(h));
  ensureProvider(h, port || 11447);
  toml = read(p);
  toml = setTopLevel(toml, "model", `"${model || "deepseek-v4.1-flash"}"`);
  toml = setTopLevel(toml, "model_provider", `"${PROXY_PROVIDER}"`);
  if (catalogPath) toml = setTopLevel(toml, "model_catalog_json", `'${catalogPath}'`);
  fs.writeFileSync(p, toml);
  return { active: "proxy", model, hasBackup: true };
}

export function restoreNormal({ home } = {}) {
  const h = home || codexHome();
  const prev = fs.existsSync(prevPath(h)) ? prevPath(h) : legacyPrevPath(h);
  if (!fs.existsSync(prev)) return { restored: false, reason: "no backup (pre-oc-gui / pre-oc-proxy)" };
  backup(cfgPath(h), h);
  fs.copyFileSync(prev, cfgPath(h));
  // Normaliza: migra backup legado p/ o nome atual.
  try {
    if (prev !== prevPath(h)) fs.copyFileSync(prev, prevPath(h));
  } catch { /* segue */ }
  return { restored: true, ...getCodexState(h) };
}
