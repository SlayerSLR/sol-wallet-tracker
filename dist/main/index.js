"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const database_js_1 = require("./database.js");
const ipc_handlers_js_1 = require("./ipc-handlers.js");
const stream_worker_js_1 = require("./stream-worker.js");
const backfill_worker_js_1 = require("./backfill-worker.js");
const price_service_js_1 = require("./price-service.js");
let mainWindow = null;
const streamWorker = new stream_worker_js_1.StreamWorker();
const backfillWorker = new backfill_worker_js_1.BackfillWorker();
const priceService = new price_service_js_1.SolPriceService();
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400, height: 900, minWidth: 1200, minHeight: 800,
        title: 'Solana Wallet Trade Tracker',
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false,
        },
    });
    mainWindow.loadFile(node_path_1.default.join(__dirname, '..', '..', 'renderer', 'index.html'));
    mainWindow.on('closed', () => { mainWindow = null; });
}
electron_1.app.whenReady().then(() => {
    const dbPath = node_path_1.default.join(electron_1.app.getPath('userData'), 'tracker.db');
    (0, database_js_1.initDatabase)(dbPath);
    createWindow();
    (0, ipc_handlers_js_1.registerIpcHandlers)(mainWindow, streamWorker, backfillWorker, priceService);
    streamWorker.start();
    priceService.start();
});
electron_1.app.on('window-all-closed', () => {
    streamWorker.stop();
    backfillWorker.stop();
    priceService.stop();
    try {
        const db = (0, database_js_1.getDb)();
        if (db)
            db.close();
    }
    catch { }
    electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
