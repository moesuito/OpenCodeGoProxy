// Setup inicial: provider + catalogo + profile --profile (opcional p/ CLI).
// Normal <-> Proxy switching happens in the GUI panel (Profiles section, with backup).
// Uso: node src/setup.mjs [--port 11447] [--model deepseek-v4.1-flash] [--claude-model minimax-m2.7]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = opt("--port", "11447");
const MODEL = opt("--model", "deepseek-v4.1-flash");
const CLAUDE_MODEL = opt("--claude-model", "minimax-m2.7");
const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const BIN = path.join(HOME, ".local", "bin");
const PROXY_JS = path.join(ROOT, "src", "proxy.mjs");

function backup(p) {
  if (!fs.existsSync(p)) return null;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
  const b = `${p}.bak-${stamp}`;
  fs.copyFileSync(p, b);
  return b;
}

function ensureCodexProvider() {
  const cfgPath = path.join(CODEX_HOME, "config.toml");
  let toml = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, "utf8") : "";
  if (!toml.includes("[model_providers.opencode_go_proxy]")) {
    backup(cfgPath);
    if (toml.length && !toml.endsWith("\n")) toml += "\n";
    toml += `\n[model_providers.opencode_go_proxy]\nname = "OpenCodeGoProxy"\nbase_url = "http://127.0.0.1:${PORT}"\nenv_key = "OPENCODE_GO_PROXY_KEY"\nwire_api = "responses"\n`;
    fs.writeFileSync(cfgPath, toml);
    console.log("[codex] provider opencode_go_proxy added (append, defaults intact)");
  } else {
    console.log("[codex] provider opencode_go_proxy already exists — nothing to do");
  }
}

function writeCatalog() {
  const dest = path.join(CODEX_HOME, "opencode-go-proxy-models.json");
  backup(dest);
  execSync(`node "${path.join(ROOT, "src", "catalog.mjs")}" --write "${dest}"`, { stdio: "inherit" });
  return dest;
}

function writeProfile(catalogPath) {
  const dest = path.join(CODEX_HOME, "opencode-go-proxy.config.toml");
  backup(dest);
  fs.writeFileSync(
    dest,
    `model = "${MODEL}"\nmodel_provider = "opencode_go_proxy"\nmodel_catalog_json = '${catalogPath}'\nmodel_reasoning_effort = "medium"\nmodel_reasoning_summary = "none"\n`
  );
  console.log(`[codex] secondary profile -> ${dest}`);
}

function writeShim(name, content) {
  fs.mkdirSync(BIN, { recursive: true });
  const dest = path.join(BIN, name);
  backup(dest);
  fs.writeFileSync(dest, content);
  console.log(`[shim] ${dest}`);
}

const HEALTH_CHECK = `curl -s -o NUL -m 3 http://127.0.0.1:${PORT}/health || start "OpenCodeGoProxy" /min node "${PROXY_JS}"\r\n`;

function setupShims(catalogPath) {
  // Shims -oc aposentados: o switch de profiles agora vive no painel GUI.
  // (Perfis --profile continuam disponiveis p/ quem prefere CLI.)
  for (const name of ["codex-oc.cmd", "codex-oc-app.cmd", "codex-oc-app-restore.cmd", "claude-oc.cmd"]) {
    const dest = path.join(BIN, name);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest);
      console.log(`[shim] removido (legado): ${dest}`);
    }
  }
}

ensureCodexProvider();
const catalogPath = writeCatalog();
writeProfile(catalogPath);
setupShims(catalogPath);
console.log("\nDone. Switch profiles from the app panel (Profiles section).");
console.log('Proxy env (any value): setx OPENCODE_GO_PROXY_KEY "local"');
