import { activateProxy } from "./profile-codex.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const r = activateProxy({ model: opt("--model", "deepseek-v4.1-flash") });
console.log(r.already ? "[app] proxy is already the default — nothing to do" : `[app] default -> proxy (backup: config.toml.pre-oc-gui)`);
console.log("[app] to revert: codex-oc-app-restore");
