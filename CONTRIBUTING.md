# Contributing to OpenCodeGoProxy

Thanks for stopping by! This project routes OpenCode Go models into Codex and
Claude Code with sanitization, quota guards and a tray app. Contributions of
all sizes are welcome — bug fixes, new model metadata, docs, translations.

## Ground rules

1. **Never commit secrets.** `config.json`, `data/ledger.json`, `data/*.jsonl`
   and `data/vision-cache.json` are gitignored for a reason. Use placeholders
   (`sk-...`) in examples and tests.
2. **Don't burn quota in tests.** Prefer offline unit tests and tiny capped
   requests (`max_tokens`/`max_output_tokens` small, no tools). Never loop
   against the live API while debugging — check the ledger (`GET /stats`).
3. **Keep the runtime zero-dependency.** `src/proxy.mjs` must run on stock
   Node 18+. Dev-only deps (electron, electron-builder) stay in
   `devDependencies`.
4. **English everywhere.** Code, docs, UI strings and commit messages.

## Dev setup

```powershell
git clone https://github.com/moesuito/OpenCodeGoProxy
cd OpenCodeGoProxy
Copy-Item config.example.json config.json   # add your own key for live tests
npm install                                  # dev deps (electron, builder)
npm run proxy                                # proxy on :11447
```

## Project map

- `src/proxy.mjs` — HTTP server, routes, ledger (`/responses`, `/chat`, `/messages`).
- `src/policies.mjs` — per-request sanitization + per-model policy.
- `src/anthropic-bridge.mjs` — Messages ↔ Chat/Responses translation (incl. SSE).
- `src/vision.mjs` — image decoder for proven-blind models (+ hash cache).
- `src/model-meta.mjs` — display names, reasoning maps, context windows,
  `UNAVAILABLE` list. **New Go model? Start here.**
- `src/keypool.mjs`, `src/prices.mjs` — rotation, budgets, cost math.
- `src/catalog.mjs` — Codex model-catalog generator.
- `src/profile-codex.mjs`, `src/profile-claude.mjs`, `src/gui-api.mjs` —
  Normal↔Proxy switching (all headless-testable, see below).
- `app/` — Electron tray shell + panel (renderer talks via `oc:call` IPC only;
  never `import()` files from the renderer).

## Testing

- `node --check <file>` must pass for every touched `.mjs`/extracted renderer script.
- Logic modules are headless-testable: point `CODEX_HOME` / `OC_CLAUDE_DIR` /
  `OPENCODE_GO_PROXY_CONFIG` at temp dirs and drive the exported functions
  (see `gui-api.mjs` header). Round-trips must restore byte-identical files.
- Live API checks: single tiny request, then confirm in `/stats`. If a test
  writes to `data/`, clean it up (never commit `data/`).
- UI changes: syntax-check the extracted `<script>` and describe the manual
  click-test performed (tray panel can't be driven headless).

## Pull requests

- One topic per PR, with before/after evidence (logs, ledger deltas, screenshots
  for UI).
- Update `docs/DOCUMENTATION.md` when behavior changes; update the
  troubleshooting table when you fix a real failure mode.
- Versioning: runtime fixes → patch, features → minor, `package.json` +
  `commit -m "vX.Y.Z: ..."`. Releases (installer) are cut by maintainers with
  `npm run dist` + `gh release create`.

## Good first issues

- Vision data for untested models (quiz: does it describe a control image?).
- `contextFor` values for models marked fallback (`omen-alpha` and friends).
- Pricing updates in `prices.mjs` when OpenCode Go docs change.
- Docs screenshots / typo fixes.

## License

MIT — see [LICENSE](LICENSE). By contributing, you agree your work ships under it.
