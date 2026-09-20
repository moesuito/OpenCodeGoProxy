// Prices per 1M tokens (peak) + monthly limit. Source: https://opencode.ai/docs/go/
// Local cost estimates — the official console (opencode.ai/auth) is the source of truth.
export const PRICES = {
  "muse-spark-1.3-contributor": { in: 0.10, out: 0.20, monthly: 60 },
  "muse-spark-1.2-contributor": { in: 0.10, out: 0.20, monthly: 60 },
  "deepseek-v4.1-flash": { in: 0.30, out: 1.20, monthly: 60 },
  "deepseek-v4-pro": { in: 1.32, out: 3.96, monthly: 15 },
  "deepseek-v4-flash": { in: 0.30, out: 1.20, monthly: 30 },
  "deepseek-flash": { in: 0.30, out: 1.20, monthly: 30 },
  "deepseek-v4-flash-vision-exp": { in: 0.30, out: 1.20, monthly: 15 },
  "gpt-5.6-luna": { in: 0.40, out: 1.80, monthly: 15 },
  "kimi-k3": { in: 3.00, out: 15.00, monthly: 15 },
  "kimi-k2.7-code": { in: 0.95, out: 4.00, monthly: 60 },
  "kimi-k2.6": { in: 0.95, out: 4.00, monthly: 60 },
  "glm-5.3-flash": { in: 0.15, out: 0.50, monthly: 60 },
  "glm-5.3": { in: 1.40, out: 4.40, monthly: 15 },
  "glm-5.2": { in: 1.40, out: 4.40, monthly: 60 },
  "glm-5.1": { in: 1.40, out: 4.40, monthly: 60 },
  "qwen3.8-max": { in: 2.00, out: 6.00, monthly: 15 },
  "qwen3.8-flash": { in: 0.15, out: 0.47, monthly: 30 },
  "qwen3.7-max": { in: 2.50, out: 7.50, monthly: 30 },
  "qwen3.7-plus": { in: 0.40, out: 1.60, monthly: 60 },
  "qwen3.6-plus": { in: 0.50, out: 3.00, monthly: 60 },
  "minimax-m3": { in: 0.30, out: 1.20, monthly: 60 },
  "minimax-m2.7": { in: 0.30, out: 1.20, monthly: 60 },
  "minimax-m2.5": { in: 0.30, out: 1.20, monthly: 60 },
  "mimo-v2.5": { in: 0.14, out: 0.28, monthly: 60 },
  "mimo-v2.5-pro": { in: 0.435, out: 0.87, monthly: 15 },
  "longcat-2.0": { in: 0.30, out: 1.20, monthly: 60 },
  "hy4-preview": { in: 0.834, out: 2.501, monthly: 30 },
  "hy3": { in: 0.14, out: 0.58, monthly: 60 },
  "grok-4.6": { in: 2.00, out: 6.00, monthly: 15 },
};

export function estimateUsd(model, inTok = 0, outTok = 0) {
  const p = PRICES[model];
  if (!p) return 0;
  return (inTok * p.in + outTok * p.out) / 1e6;
}
