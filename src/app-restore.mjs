import { restoreNormal } from "./profile-codex.mjs";

const r = restoreNormal();
console.log(r.restored ? "[app] padrao restaurado" : `[app] nada a restaurar (${r.reason})`);
