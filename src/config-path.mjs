// Resolucao do config (compartilhada entre proxy, setups e painel):
// 1) OPENCODE_GO_PROXY_CONFIG (env)  2) <repo>/config.json  3) %APPDATA%/OpenCodeGoProxy/config.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SRC_DIR);

export function resolveConfigPath() {
  if (process.env.OPENCODE_GO_PROXY_CONFIG && fs.existsSync(process.env.OPENCODE_GO_PROXY_CONFIG)) {
    return process.env.OPENCODE_GO_PROXY_CONFIG;
  }
  const repoCfg = path.join(REPO_ROOT, "config.json");
  if (fs.existsSync(repoCfg)) return repoCfg;
  const appCfg = path.join(os.homedir(), "AppData", "Roaming", "OpenCodeGoProxy", "config.json");
  if (fs.existsSync(appCfg)) return appCfg;
  return repoCfg; // default (vai falhar com mensagem util se nao existir)
}

export function dataDirFor(configPath) {
  return path.join(path.dirname(configPath), "data");
}
