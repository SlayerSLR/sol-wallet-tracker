import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { initDatabase, getDb } from './database.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { StreamWorker } from './stream-worker.js';
import { BackfillWorker } from './backfill-worker.js';
import { SolPriceService } from './price-service.js';

let mainWindow: BrowserWindow | null = null;
const streamWorker = new StreamWorker();
const backfillWorker = new BackfillWorker();
const priceService = new SolPriceService();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1200, minHeight: 800,
    title: 'Solana Wallet Trade Tracker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}


app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'tracker.db');
  initDatabase(dbPath);

  createWindow();

  registerIpcHandlers(mainWindow!, streamWorker, backfillWorker, priceService);

  streamWorker.start();
  priceService.start();
});

app.on('window-all-closed', () => {
  streamWorker.stop();
  backfillWorker.stop();
  priceService.stop();
  try {
    const db = getDb();
    if (db) db.close();
  } catch {}
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
