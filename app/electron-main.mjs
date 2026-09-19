// Shell Electron (tray) — requer `npm i -D electron` (nao vem instalado).
// Roda o proxy em-processo (sem depender de Node externo no instalador)
// e oferece painel minimo de configuracao.
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let electron;
try {
  electron = await import("electron");
} catch {
  console.error("Electron nao instalado. Rode: npm i -D electron");
  process.exit(1);
}
const { app, Tray, Menu, BrowserWindow, Notification, nativeImage } = electron;

let proxyMod = null;
let win = null;
let tray = null;

async function startProxy() {
  if (proxyMod) return;
  try {
    proxyMod = await import("../src/proxy.mjs");
  } catch (e) {
    console.error("Proxy nao iniciou:", e.message);
    if (Notification.isSupported()) {
      new Notification({
        title: "OpenCodeGoProxy",
        body: "Configure sua API key no painel e reinicie. (" + e.message + ")",
      }).show();
    }
  }
}

function openPanel() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 640,
    height: 560,
    title: "OpenCodeGoProxy",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(ROOT, "app", "renderer", "index.html"));
  win.on("close", (e) => {
    e.preventDefault();
    win.hide();
  });
}

app.whenReady().then(() => {
  startProxy();
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("OpenCodeGoProxy");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir painel", click: openPanel },
      {
        label: "Reiniciar app+proxy",
        click: () => {
          app.relaunch();
          app.quit();
        },
      },
      { type: "separator" },
      { label: "Sair", click: () => app.quit() },
    ])
  );
  tray.on("click", openPanel);
  if (Notification.isSupported()) {
    new Notification({ title: "OpenCodeGoProxy", body: "Proxy no ar (tray)." }).show();
  }
});

app.on("window-all-closed", (e) => e.preventDefault());
