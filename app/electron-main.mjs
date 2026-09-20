// Shell Electron (tray).
// Roda o proxy em-processo (sem depender de Node externo no instalador)
// e oferece painel de configuracao. Suporta --minimized (boot silencioso)
// e trava de instancia unica (segundo clique abre o painel existente).
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let electron;
try {
  electron = await import("electron");
} catch {
  console.error("Electron not installed. Run: npm i -D electron");
  process.exit(1);
}
const { app, Tray, Menu, BrowserWindow, Notification, nativeImage, ipcMain } = electron;
Menu.setApplicationMenu(null);
const { api } = await import("../src/gui-api.mjs");
ipcMain.handle("oc:call", async (_event, name, args) => {
  if (typeof api[name] !== "function") throw new Error(`api desconhecida: ${name}`);
  return api[name](args);
});
const { loadSettings } = await import("../src/app-settings.mjs");

if (!app.requestSingleInstanceLock()) {
  console.log("Another instance is already running. Exiting.");
  app.quit();
  process.exit(0);
}

const MINIMIZED = process.argv.includes("--minimized");
const settings = loadSettings();

let proxyMod = null;
let win = null;
let tray = null;
let isQuitting = false;

app.on("before-quit", () => {
  isQuitting = true;
});

async function startProxy() {
  if (proxyMod) return;
  try {
    proxyMod = await import("../src/proxy.mjs");
  } catch (e) {
    console.error("Proxy did not start:", e.message);
    if (Notification.isSupported()) {
      new Notification({
        title: "OpenCodeGoProxy",
        body: "Set your API key in the panel and restart. (" + e.message + ")",
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
    width: 620,
    height: 600,
    title: "OpenCodeGoProxy",
    autoHideMenuBar: true,
    icon: path.join(ROOT, "assets", "icon.ico"),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(ROOT, "app", "renderer", "index.html"));
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

app.on("second-instance", () => {
  openPanel();
});

app.whenReady().then(() => {
  startProxy();
  const trayIcon = nativeImage.createFromPath(path.join(ROOT, "assets", "tray.png"));
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip("OpenCodeGoProxy");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open panel", click: openPanel },
      {
        label: "Restart app+proxy",
        click: () => {
          app.relaunch();
          app.quit();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ])
  );
  tray.on("click", openPanel);
  const silent = MINIMIZED || settings.startMinimized === true;
  if (!silent) {
    openPanel();
    if (Notification.isSupported()) {
      new Notification({ title: "OpenCodeGoProxy", body: "Proxy is up (tray)." }).show();
    }
  }
});

app.on("window-all-closed", (e) => e.preventDefault());
