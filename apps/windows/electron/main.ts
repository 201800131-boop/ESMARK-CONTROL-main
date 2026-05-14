import { app, BrowserWindow, screen, shell } from "electron";
import path from "path";
import fs from "fs";
import { autoUpdater } from "electron-updater";

const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

function getAppIconPath(): string {
  if (app.isPackaged) {
    // Try multiple possible locations in packaged app
    const possiblePaths = [
      path.join(process.resourcesPath, "app-icon.ico"),
      path.join(__dirname, "../../app-icon.ico"),
      path.join(app.getAppPath(), "app-icon.ico"),
    ];

    for (const p of possiblePaths) {
      try {
        fs.accessSync(p);
        return p;
      } catch (e) {
        // Continue to next path
      }
    }

    // Fallback to first path if none found (will show default icon)
    return possiblePaths[0];
  } else {
    // Dev mode
    return path.join(process.cwd(), "public", "app-icon.ico");
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "ESMARK Control",
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Abrir links externos en el navegador del sistema (no en Electron)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

function createUpdateOverlay(parent: BrowserWindow): BrowserWindow {
  const overlay = new BrowserWindow({
    width: 360,
    height: 140,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#101820",
    parent,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, sans-serif;
      background: linear-gradient(135deg, #101820, #1a2635);
      color: #f4f7fb;
      padding: 16px;
      box-sizing: border-box;
    }
    #title {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    #message {
      font-size: 12px;
      color: #c7d2df;
      margin-bottom: 10px;
      line-height: 1.3;
    }
    #track {
      width: 100%;
      height: 8px;
      border-radius: 8px;
      background: #28384a;
      overflow: hidden;
    }
    #fill {
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #0fb9b1, #20bf6b);
      transition: width 180ms ease;
    }
    #percent {
      margin-top: 8px;
      font-size: 12px;
      color: #9ec4ff;
    }
  </style>
</head>
<body>
  <div id="title">Actualización disponible</div>
  <div id="message">Preparando descarga...</div>
  <div id="track"><div id="fill"></div></div>
  <div id="percent">0%</div>
</body>
</html>`;

  const encoded = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  void overlay.loadURL(encoded);
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const area = screen.getDisplayMatching(parent.getBounds()).workArea;
  const [w, h] = overlay.getSize();
  overlay.setPosition(
    area.x + area.width - w - 14,
    area.y + area.height - h - 14,
  );

  return overlay;
}

function updateOverlay(
  overlay: BrowserWindow,
  title: string,
  message: string,
  percent: number,
): void {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  const script = `
    document.getElementById("title").textContent = ${JSON.stringify(title)};
    document.getElementById("message").textContent = ${JSON.stringify(message)};
    document.getElementById("fill").style.width = ${JSON.stringify(`${safePercent}%`)};
    document.getElementById("percent").textContent = ${JSON.stringify(`${safePercent}%`)};
  `;
  void overlay.webContents.executeJavaScript(script);
}

function createUpdateReadyWindow(parent: BrowserWindow, version: string): BrowserWindow {
  const updateWindow = new BrowserWindow({
    width: 430,
    height: 245,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#f8fafc",
    parent,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, sans-serif;
      background: #f8fafc;
      color: #162033;
      user-select: none;
    }
    .titlebar {
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px 0 18px;
      background: #101820;
      color: #fff;
      -webkit-app-region: drag;
    }
    .titlebar span {
      font-size: 13px;
      font-weight: 700;
    }
    .close {
      width: 30px;
      height: 30px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #dbe5ef;
      font-size: 20px;
      line-height: 28px;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    .close:hover { background: rgba(255, 255, 255, 0.12); }
    main { padding: 22px 24px 20px; }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #516070;
      font-size: 13px;
      line-height: 1.45;
    }
    .version {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid #d9e2ec;
      border-radius: 8px;
      background: #fff;
      font-size: 13px;
      color: #223044;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }
    button {
      min-width: 112px;
      height: 36px;
      border-radius: 7px;
      border: 1px solid #cbd5e1;
      font: 600 13px "Segoe UI", Tahoma, sans-serif;
      cursor: pointer;
    }
    .secondary {
      background: #fff;
      color: #304154;
    }
    .primary {
      border-color: #0f766e;
      background: #0f766e;
      color: #fff;
    }
    .primary:hover { background: #115e59; }
    .secondary:hover { background: #f1f5f9; }
  </style>
</head>
<body>
  <div class="titlebar">
    <span>Actualización de ESMARK Control</span>
    <button class="close" id="later-x" aria-label="Cerrar">×</button>
  </div>
  <main>
    <h1>Hay una nueva versión lista</h1>
    <p>La actualización ya se descargó. Para aplicarla, la app se cerrará y volverá a abrirse automáticamente.</p>
    <div class="version">Versión disponible: <strong>v${version}</strong></div>
    <div class="actions">
      <button class="secondary" id="later">Más tarde</button>
      <button class="primary" id="install">Instalar ahora</button>
    </div>
  </main>
  <script>
    const send = (action) => {
      window.location.href = "esmark-update://" + action;
    };
    document.getElementById("install").addEventListener("click", () => send("install"));
    document.getElementById("later").addEventListener("click", () => send("later"));
    document.getElementById("later-x").addEventListener("click", () => send("later"));
  </script>
</body>
</html>`;

  const encoded = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  updateWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("esmark-update://")) return;

    event.preventDefault();
    if (url === "esmark-update://install") {
      autoUpdater.quitAndInstall();
      return;
    }

    if (!updateWindow.isDestroyed()) {
      updateWindow.close();
    }
  });
  void updateWindow.loadURL(encoded);
  updateWindow.once("ready-to-show", () => updateWindow.show());

  return updateWindow;
}

function setupAutoUpdates(win: BrowserWindow): void {
  if (!app.isPackaged) return;

  let updateOverlayWindow: BrowserWindow | null = null;
  let updateReadyWindow: BrowserWindow | null = null;
  const getOverlay = (): BrowserWindow => {
    if (!updateOverlayWindow || updateOverlayWindow.isDestroyed()) {
      updateOverlayWindow = createUpdateOverlay(win);
    }
    return updateOverlayWindow;
  };

  // Configurar electron-updater para descargas delta (solo cambios, no todo el archivo)
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("error", (error) => {
    console.error("AutoUpdater error:", error);
  });

  // Cuando se detecta una actualización disponible - descarga silenciosamente
  autoUpdater.on("update-available", (info) => {
    console.log("✓ Actualización disponible:", info.version);
    console.log("  Descargando silenciosamente en background...");
    const overlay = getOverlay();
    overlay.showInactive();
    updateOverlay(
      overlay,
      `Actualizando a v${info.version}`,
      "Descargando actualización en segundo plano...",
      0,
    );
  });

  // Progreso de descarga con ventana flotante
  autoUpdater.on("download-progress", (progress) => {
    console.log(
      `  Descarga: ${Math.round(progress.percent)}% (${progress.transferred}/${progress.total} bytes)`,
    );
    const overlay = getOverlay();
    overlay.showInactive();
    updateOverlay(
      overlay,
      "Descargando actualización",
      "La nueva versión se instalará cuando la confirmes.",
      progress.percent,
    );
  });

  // Cuando la actualización se ha descargado completamente
  autoUpdater.on("update-downloaded", (info) => {
    console.log("✓ Actualización lista para instalar:", info.version);
    if (updateOverlayWindow && !updateOverlayWindow.isDestroyed()) {
      updateOverlay(
        updateOverlayWindow,
        `Actualización v${info.version} lista`,
        'Pulsa "Instalar ahora" para reiniciar y aplicar cambios.',
        100,
      );
    }
    if (updateReadyWindow && !updateReadyWindow.isDestroyed()) {
      updateReadyWindow.focus();
      return;
    }

    updateReadyWindow = createUpdateReadyWindow(win, info.version);
    updateReadyWindow.on("closed", () => {
      updateReadyWindow = null;
    });
  });

  console.log("Checando actualizaciones al iniciar...");
  void autoUpdater.checkForUpdates();

  // Revisa actualizaciones cada 5 minutos mientras la app esté abierta
  const updateCheckInterval = setInterval(
    () => {
      console.log("Checando actualizaciones...");
      void autoUpdater.checkForUpdates();
    },
    1000 * 60 * 5,
  );

  // Revisa actualizaciones cuando la app gana focus (cambias de ventana y vuelves)
  win.on("focus", () => {
    console.log("App en focus - checando actualizaciones...");
    void autoUpdater.checkForUpdates();
  });

  // Limpia el intervalo cuando se cierra la ventana
  win.on("closed", () => {
    clearInterval(updateCheckInterval);
    if (updateOverlayWindow && !updateOverlayWindow.isDestroyed()) {
      updateOverlayWindow.close();
      updateOverlayWindow = null;
    }
    if (updateReadyWindow && !updateReadyWindow.isDestroyed()) {
      updateReadyWindow.close();
      updateReadyWindow = null;
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.esmark.control");
  }

  const win = createWindow();
  setupAutoUpdates(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const activeWin = createWindow();
      setupAutoUpdates(activeWin);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
