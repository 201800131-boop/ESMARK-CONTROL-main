import { app, BrowserWindow, shell } from 'electron';
import path from 'path';

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ESMARK Control',
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
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
