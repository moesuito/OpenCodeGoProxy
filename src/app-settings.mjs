// Configs do app desktop: autostart (Registro Run), iniciar minimizado.
// Sem IPC: o painel chama estas funcoes direto (nodeIntegration) e o main
// le as mesmas na inicializacao. Chave: HKCU\...\Run valor OpenCodeGoProxy.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_DIR = path.join(os.homedir(), "AppData", "Roaming", "OpenCodeGoProxy");
const SETTINGS_PATH = path.join(APP_DIR, "settings.json");
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE = "OpenCodeGoProxy";

export function settingsPath() {
  return SETTINGS_PATH;
}

export function loadSettings() {
  try {
    return { autoStart: false, startMinimized: true, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) };
  } catch {
    return { autoStart: false, startMinimized: true };
  }
}

export function saveSettings(s) {
  fs.mkdirSync(APP_DIR, { recursive: true });
  const cur = loadSettings();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...cur, ...s }, null, 2));
  return loadSettings();
}

function reg(args) {
  return new Promise((resolve) => {
    execFile("reg", args, { windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || "") });
    });
  });
}

export async function isAutoStart() {
  if (process.platform !== "win32") return false;
  const r = await reg(["query", RUN_KEY, "/v", VALUE]);
  return r.ok && r.out.includes(VALUE);
}

export async function setAutoStart(on, exePath, minimized) {
  if (process.platform !== "win32") throw new Error("autostart suportado so no Windows");
  if (!on) {
    await reg(["delete", RUN_KEY, "/v", VALUE, "/f"]);
    return false;
  }
  const target = minimized ? `"${exePath}" --minimized` : `"${exePath}"`;
  const r = await reg(["add", RUN_KEY, "/v", VALUE, "/t", "REG_SZ", "/d", target, "/f"]);
  if (!r.ok) throw new Error("falha ao registrar autostart");
  return true;
}
