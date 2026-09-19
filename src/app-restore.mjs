// Restaura o config.toml anterior ao `codex-oc-app`.
// Uso: node src/app-restore.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const CFG = path.join(CODEX_HOME, "config.toml");
const PREV = path.join(CODEX_HOME, "config.toml.pre-oc-proxy");

if (!fs.existsSync(PREV)) {
  console.log("[app] nada a restaurar (sem backup pre-oc-proxy)");
  process.exit(0);
}
fs.copyFileSync(CFG, `${CFG}.bak-pos-oc-proxy`);
fs.copyFileSync(PREV, CFG);
console.log("[app] padrao restaurado (backup do estado proxy: config.toml.bak-pos-oc-proxy)");
