// Setup NAO-DESTRUTIVO: cria profile secundario + shims, sem tocar no padrao.
// - Codex: provider opencode_go_proxy (append) + catalogo + profile opencode-go-proxy.
//   O model/model_provider padrao do usuario NAO e alterado.
// - Shims no %USERPROFILE%\.local\bin (ja esta no PATH):
//     codex-oc      -> Codex CLI no profile do proxy
//     codex-oc-app  -> fecha Codex/ChatGPT abertos e abre o Desktop App no proxy
//     claude-oc     -> Claude Code CLI via proxy (/messages)
// Abrir codex/claude/app normalmente continua usando a autenticacao padrao.
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
    console.log("[codex] provider opencode_go_proxy adicionado (append, padrao intacto)");
  } else {
    console.log("[codex] provider opencode_go_proxy ja existe — nada a fazer");
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
  console.log(`[codex] profile secundario -> ${dest}`);
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
  writeShim(
    "codex-oc.cmd",
    `@echo off\r\nREM Codex CLI via proxy OpenCodeGoProxy (nao altera o padrao)\r\n${HEALTH_CHECK}codex --profile opencode-go-proxy %*\r\n`
  );
  writeShim(
    "codex-oc-app.cmd",
    `@echo off\r\nREM Fecha Codex/ChatGPT abertos e abre o Desktop App no proxy\r\n${HEALTH_CHECK}taskkill /F /IM Codex.exe 2>NUL\r\ntaskkill /F /IM ChatGPT.exe 2>NUL\r\ntimeout /t 2 /nobreak >NUL\r\ncodex app -c "model_provider='opencode_go_proxy'" -c "model='${MODEL}'" -c "model_catalog_json='${catalogPath}'" %*\r\n`
  );
  writeShim(
    "claude-oc.cmd",
    `@echo off\r\nREM Claude Code CLI via proxy OpenCodeGoProxy (nao altera o padrao)\r\n${HEALTH_CHECK}set ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT}\r\nset ANTHROPIC_API_KEY=local\r\nif "%OC_PROXY_MODEL%"=="" set OC_PROXY_MODEL=${CLAUDE_MODEL}\r\nset ANTHROPIC_MODEL=%OC_PROXY_MODEL%\r\nclaude %*\r\n`
  );
}

ensureCodexProvider();
const catalogPath = writeCatalog();
writeProfile(catalogPath);
setupShims(catalogPath);
console.log("\nPronto (nada do padrao foi alterado):");
console.log("  codex-oc        -> Codex CLI no proxy");
console.log("  codex-oc-app    -> Codex Desktop App no proxy (fecha o aberto antes)");
console.log("  claude-oc       -> Claude Code CLI no proxy (modelo via OC_PROXY_MODEL)");
console.log('  Env do proxy (qualquer valor): setx OPENCODE_GO_PROXY_KEY "local"');
