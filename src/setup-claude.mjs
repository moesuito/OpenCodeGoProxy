// Instrucoes/config para o Claude Code usar o proxy (endpoint /messages, padrao Anthropic).
// Uso: node src/setup-claude.mjs [--port 11447] [--model deepseek-v4.1-flash]
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = opt("--port", "11447");
const MODEL = opt("--model", "deepseek-v4.1-flash");

console.log("# Claude Code via OpenCodeGoProxy");
console.log("# O proxy expoe POST /v1/messages repassando ao endpoint /messages do Go.");
console.log("# Atencao: valide nos termos do seu plano se o roteamento e permitido.");
console.log("");
console.log(`$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:${PORT}"`);
console.log(`$env:ANTHROPIC_API_KEY = "local"`);
console.log(`$env:ANTHROPIC_MODEL = "${MODEL}"`);
console.log("");
console.log("# Bash:");
console.log(`export ANTHROPIC_BASE_URL="http://127.0.0.1:${PORT}"`);
console.log(`export ANTHROPIC_API_KEY="local"`);
console.log(`export ANTHROPIC_MODEL="${MODEL}"`);
console.log("");
console.log("# Modelos com endpoint nativo /messages no Go: minimax-*, qwen3.*.");
console.log("# Demais modelos passam pelo proxy no modo passthrough — se algum falhar,");
console.log("# rode com um dos nativos acima ou abra uma issue com o log do proxy.");
