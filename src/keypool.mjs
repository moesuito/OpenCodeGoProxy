// Pool de chaves OpenCode Go: round-robin com fallback em 429/5xx e
// trava de orcamento diario por chave (estimativa local via prices.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateUsd } from "./prices.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEDGER = path.join(ROOT, "data", "ledger.json");

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function loadLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  } catch {
    return {};
  }
}

export function saveLedger(l) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2));
}

export class KeyPool {
  constructor(keys) {
    this.keys = (keys || []).filter((k) => k.key && k.enabled !== false);
    this.idx = 0;
    if (this.keys.length === 0) throw new Error("Nenhuma API key configurada (config.json > keys).");
  }

  ledger() {
    return loadLedger();
  }

  overBudget(entry) {
    if (!entry.dayBudgetUsd) return false;
    const day = today();
    const spent = this.ledger()[entry.name]?.[day] || 0;
    return spent >= entry.dayBudgetUsd;
  }

  // proxima chave saudavel (respeita orcamento)
  next(exclude = new Set()) {
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[(this.idx + i) % this.keys.length];
      if (!exclude.has(k.name) && !this.overBudget(k)) return k;
    }
    return null;
  }

  advance() {
    this.idx = (this.idx + 1) % this.keys.length;
  }

  record(entry, model, inTok, outTok) {
    const usd = estimateUsd(model, inTok, outTok);
    const l = loadLedger();
    const day = today();
    l[entry.name] = l[entry.name] || {};
    l[entry.name][day] = (l[entry.name][day] || 0) + usd;
    saveLedger(l);
    return usd;
  }
}
