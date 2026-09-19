// Ativa o proxy como padrao no config.toml BASE (o App Desktop ignora -c
// para o picker de modelos). Guarda o anterior em config.toml.pre-oc-proxy.
// Uso: node src/app-activate.mjs [--model deepseek-v4.1-flash]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const MODEL = opt("--model", "deepseek-v4.1-flash");
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const CFG = path.join(CODEX_HOME, "config.toml");
const PREV = path.join(CODEX_HOME, "config.toml.pre-oc-proxy");
const CATALOG = path.join(CODEX_HOME, "opencode-go-proxy-models.json");

let toml = fs.existsSync(CFG) ? fs.readFileSync(CFG, "utf8") : "";
if (toml.includes('model_provider = "opencode_go_proxy"') && toml.includes(`model = "${MODEL}"`)) {
  console.log("[app] proxy ja e o padrao — nada a fazer");
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
fs.copyFileSync(CFG, `${CFG}.bak-${stamp}`);
fs.copyFileSync(CFG, PREV);

function setTopLevel(src, key, value) {
  const re = new RegExp(`^${key}\\s*=.*$`, "m");
  if (re.test(src)) return src.replace(re, `${key} = ${value}`);
  return `${key} = ${value}\n${src}`;
}

toml = setTopLevel(toml, "model", `"${MODEL}"`);
toml = setTopLevel(toml, "model_provider", `"opencode_go_proxy"`);
toml = setTopLevel(toml, "model_catalog_json", `'${CATALOG}'`);
fs.writeFileSync(CFG, toml);
console.log(`[app] padrao -> ${MODEL} via opencode_go_proxy (backup: config.toml.pre-oc-proxy)`);
console.log("[app] para voltar: codex-oc-app-restore");
