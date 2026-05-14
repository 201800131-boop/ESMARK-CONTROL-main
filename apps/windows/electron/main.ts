import { app, BrowserWindow, dialog, shell } from "electron";
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

function setupAutoUpdates(win: BrowserWindow): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("error", (error) => {
    console.error("AutoUpdater error:", error);
  });

  // Cuando se detecta una actualización disponible
  autoUpdater.on("update-available", (info) => {
    console.log("Actualización disponible:", info.version);
    void dialog.showMessageBox(win, {
      type: "info",
      title: "Actualización disponible",
      message: `Nueva versión: ${info.version}`,
      detail:
        "Se está descargando la actualización. Te avisaremos cuando esté lista para instalar.",
      buttons: ["OK"],
      defaultId: 0,
    });
  });

  // Cuando la actualización se ha descargado completamente
  autoUpdater.on("update-downloaded", (info) => {
    console.log("Actualización descargada:", info.version);
    void dialog
      .showMessageBox(win, {
        type: "info",
        title: "¡Actualización lista!",
        message: `ESMARK Control v${info.version} está lista para instalar.`,
        detail:
          "Se desinstalará la versión anterior y se instalará la nueva automáticamente.",
        buttons: ["Instalar ahora", "Más tarde"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  console.log("Checando actualizaciones al iniciar...");
  void autoUpdater.checkForUpdates();

  // Revisa actualizaciones cada 5 minutos mientras la app esté abierta
  const updateCheckInterval = setInterval(
    () => {
      console.log("Checando actualizaciones (intervalo de 5 minutos)...");
      void autoUpdater.checkForUpdates();
    },
    1000 * 60 * 5,
  );

  // Revisa actualizaciones cuando la app gana focus
  win.on("focus", () => {
    console.log("App en focus - checando actualizaciones...");
    void autoUpdater.checkForUpdates();
  });

  // Limpia el intervalo cuando se cierra la ventana
  win.on("closed", () => {
    clearInterval(updateCheckInterval);
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
