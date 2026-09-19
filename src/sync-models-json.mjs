// Gera app/renderer/models.json a partir de src/prices.mjs (fonte unica).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRICES } from "./prices.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rows = Object.entries(PRICES).map(([id, p]) => ({
  id,
  inputUsdPer1M: p.in,
  outputUsdPer1M: p.out,
  monthlyUsd: p.monthly,
}));
fs.writeFileSync(path.join(ROOT, "app", "renderer", "models.json"), JSON.stringify(rows, null, 2));
console.log(`${rows.length} modelos -> app/renderer/models.json`);
