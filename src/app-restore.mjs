import { restoreNormal } from "./profile-codex.mjs";

const r = restoreNormal();
console.log(r.restored ? "[app] default restored" : `[app] nothing to restore (${r.reason})`);
