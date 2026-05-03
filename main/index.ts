import { app, BrowserWindow, ipcMain, clipboard, shell } from 'electron';
import path from 'node:path';
import { spawnBackend, type BackendHandle } from './backend.js';

let mainWindow: BrowserWindow | null = null;
let backendHandle: BackendHandle | null = null;

function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1200, minHeight: 800,
    title: 'Solana Wallet Trade Tracker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--backend-port=${port}`],
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerLocalHandlers() {
  ipcMain.handle('local:clipboard:copy', (_e, text: string) => { clipboard.writeText(text); });
  ipcMain.handle('local:open-external', (_e, url: string) => { shell.openExternal(url); });
}

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'tracker.db');

  try {
    backendHandle = await spawnBackend(dbPath);
  } catch (err: any) {
    console.error('Backend failed to start:', err.message);
    app.quit();
    return;
  }

  registerLocalHandlers();
  createWindow(backendHandle.port);
});

app.on('window-all-closed', () => {
  if (backendHandle) {
    backendHandle.process.kill();
    backendHandle = null;
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendHandle) {
    createWindow(backendHandle.port);
  }
});
