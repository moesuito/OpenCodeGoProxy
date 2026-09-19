// Switch de profile do Claude Code CLI: Normal <-> OpenCodeGoProxy.
// Troca apenas endpoint+key no settings.json (mantem os modelos do usuario).
// Backup em settings.json.pre-oc-gui (+ timestamped).
// (A extensao do VS Code usa o CLI como backend: mesmo settings, coberto.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function claudeDir() {
  return process.env.OC_CLAUDE_DIR || path.join(os.homedir(), ".claude");
}
const settingsPath = (dir) => path.join(dir || claudeDir(), "settings.json");
const prevPath = (dir) => path.join(dir || claudeDir(), "settings.json.pre-oc-gui");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function getClaudeState(dir) {
  const p = settingsPath(dir);
  if (!fs.existsSync(p)) return { active: "unknown", reason: "settings.json ausente", hasBackup: false };
  const s = readJson(p);
  const base = s?.env?.ANTHROPIC_BASE_URL || "";
  const active = /127\.0\.0\.1:11447|localhost:11447/.test(base) ? "proxy" : "normal";
  return { active, baseUrl: base, model: s?.env?.ANTHROPIC_MODEL, hasBackup: fs.existsSync(prevPath(dir)) };
}

export function backup(p, dir) {
  if (!fs.existsSync(p)) return null;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
  const b = `${p}.bak-${stamp}`;
  fs.copyFileSync(p, b);
  return b;
}

// Ativa o proxy (endpoint+key). Modelos do usuario sao preservados.
export function activateProxy({ dir, port } = {}) {
  const d = dir || claudeDir();
  const p = settingsPath(d);
  if (!fs.existsSync(p)) throw new Error("settings.json do Claude nao encontrado");
  const st = getClaudeState(d);
  if (st.active === "proxy") return { already: true, ...st };
  backup(p, d);
  fs.copyFileSync(p, prevPath(d));
  const s = readJson(p);
  s.env = s.env || {};
  s.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port || 11447}`;
  s.env.ANTHROPIC_API_KEY = "local";
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
  return { active: "proxy", hasBackup: true };
}

export function restoreNormal({ dir } = {}) {
  const d = dir || claudeDir();
  const prev = prevPath(d);
  if (!fs.existsSync(prev)) return { restored: false, reason: "sem backup pre-oc-gui" };
  backup(settingsPath(d), d);
  fs.copyFileSync(prev, settingsPath(d));
  return { restored: true, ...getClaudeState(d) };
}
