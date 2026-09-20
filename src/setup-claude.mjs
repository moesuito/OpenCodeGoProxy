// Instructions/config for Claude Code through the proxy (/messages endpoint, Anthropic shape).
// Uso: node src/setup-claude.mjs [--port 11447] [--model deepseek-v4.1-flash]
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = opt("--port", "11447");
const MODEL = opt("--model", "deepseek-v4.1-flash");

console.log("# Claude Code via OpenCodeGoProxy");
console.log("# The proxy exposes POST /v1/messages, forwarded to Go's /messages endpoint.");
console.log("# Note: check your plan terms to confirm routing is allowed.");
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
console.log("# Models with a native /messages endpoint on Go: minimax-*, qwen3.*.");
console.log("# Other models go through the proxy in passthrough mode — if one fails,");
console.log("# run with one of the natives above or open an issue with the proxy log.");
