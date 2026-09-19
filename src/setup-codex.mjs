// Gera os arquivos do Codex (CLI + App) apontando para o proxy local.
// Uso: node src/setup-codex.mjs [--port 11447] [--model deepseek-v4.1-flash]
// Nao sobrescreve nada sem backup (.bak-YYYYMMDD-HHmmss).
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
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

function backup(p) {
  if (!fs.existsSync(p)) return;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
  fs.copyFileSync(p, `${p}.bak-${stamp}`);
}

function ensureProvider() {
  const cfgPath = path.join(CODEX_HOME, "config.toml");
  let toml = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, "utf8") : "";
  if (!toml.includes("[model_providers.opencode_go_proxy]")) {
    backup(cfgPath);
    toml += `\n[model_providers.opencode_go_proxy]\nname = "OpenCodeGoProxy"\nbase_url = "http://127.0.0.1:${PORT}"\nenv_key = "OPENCODE_GO_PROXY_KEY"\nwire_api = "responses"\n`;
    fs.writeFileSync(cfgPath, toml);
    console.log("provider opencode_go_proxy adicionado ao config.toml");
  } else {
    console.log("provider opencode_go_proxy ja existe no config.toml");
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
  console.log(`profile opencode-go-proxy -> ${dest}`);
  console.log("Uso CLI: codex --profile opencode-go-proxy");
  console.log(
    `Uso App:  codex app -c "model_provider='opencode_go_proxy'" -c "model='${MODEL}'" -c "model_catalog_json='${catalogPath}'"`
  );
}

ensureProvider();
const catalogPath = writeCatalog();
writeProfile(catalogPath);
console.log("\nDefina a env do proxy (qualquer valor — a key real fica no config.json do proxy):");
console.log('  setx OPENCODE_GO_PROXY_KEY "local"   (novo terminal depois)');
