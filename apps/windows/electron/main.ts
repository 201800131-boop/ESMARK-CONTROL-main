import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'path';
import { autoUpdater } from 'electron-updater';

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function getAppIconPath(): string {
  return app.isPackaged
    ? path.join(__dirname, '../dist/esmark-logo.png')
    : path.join(process.cwd(), 'public', 'esmark-logo.png');
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ESMARK Control',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Abrir links externos en el navegador del sistema (no en Electron)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return win;
}

function setupAutoUpdates(win: BrowserWindow): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    console.error('AutoUpdater error:', error);
  });

  autoUpdater.on('update-downloaded', () => {
    void dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Actualizacion lista',
        message: 'Se descargo una nueva version de ESMARK Control.',
        detail: 'Reinicia la aplicacion para instalarla ahora.',
        buttons: ['Reiniciar ahora', 'Mas tarde'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  void autoUpdater.checkForUpdates();

  // Revisa actualizaciones periodicamente mientras la app este abierta.
  setInterval(() => {
    void autoUpdater.checkForUpdates();
  }, 1000 * 60 * 60 * 6);
}

app.whenReady().then(() => {
  const win = createWindow();
  setupAutoUpdates(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const activeWin = createWindow();
      setupAutoUpdates(activeWin);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
