"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const db = __importStar(require("./database.js"));
function ok(data) { return { ok: true, data }; }
function err(error) { return { ok: false, error }; }
function handler(fn) {
    return (...args) => {
        try {
            return ok(fn(...args));
        }
        catch (e) {
            return err(e?.message || String(e));
        }
    };
}
function handlerAsync(fn) {
    return async (...args) => {
        try {
            return ok(await fn(...args));
        }
        catch (e) {
            return err(e?.message || String(e));
        }
    };
}
function registerIpcHandlers(mainWindow, streamWorker, backfillWorker, priceService) {
    // === DB handlers (standardized {ok, data/error}) ===
    electron_1.ipcMain.handle('db:stats', handler(() => db.getDashboardStats()));
    electron_1.ipcMain.handle('db:trades:recent', handler((_e, limit) => db.getRecentTrades(limit)));
    electron_1.ipcMain.handle('db:traders:top', handler((_e, limit) => db.getTopTradersByVolume(limit)));
    electron_1.ipcMain.handle('db:tokens:top', handler((_e, limit) => db.getTopTokensByVolume(limit)));
    electron_1.ipcMain.handle('db:tokens:overlap', handler((_e, min) => db.getOverlappingTokens(min)));
    electron_1.ipcMain.handle('db:wallet:stats', handler((_e, addr) => db.getWalletStats(addr)));
    electron_1.ipcMain.handle('db:wallet:trades', handler((_e, addr, limit) => db.getWalletTrades(addr, limit)));
    electron_1.ipcMain.handle('db:pnl:get', handler((_e, addr) => db.getWalletPnL(addr ?? undefined)));
    electron_1.ipcMain.handle('db:token:stats', handler((_e, mint) => db.getTokenStats(mint)));
    electron_1.ipcMain.handle('db:token:trades', handler((_e, mint, limit) => db.getTokenTrades(mint, limit)));
    electron_1.ipcMain.handle('db:tokens:list', handler(() => db.getTokens()));
    electron_1.ipcMain.handle('db:wallets:list', handler(() => db.getWallets()));
    electron_1.ipcMain.handle('db:wallet:add', handler((_e, addr, label, tags) => db.addWallet(addr, label, tags)));
    electron_1.ipcMain.handle('db:wallets:import', handler((_e, items) => db.importWallets(items)));
    electron_1.ipcMain.handle('db:wallet:remove', handler((_e, addr) => { db.removeWallet(addr); }));
    electron_1.ipcMain.handle('db:wallet:update', handler((_e, addr, label, tags) => { db.updateWallet(addr, label, tags); }));
    electron_1.ipcMain.handle('db:pnl:recompute', handler(() => { db.recomputeAllPnL(); }));
    electron_1.ipcMain.handle('db:backfill:progress', handler(() => db.getBackfillProgress()));
    electron_1.ipcMain.handle('db:wallets:import-chunked', handlerAsync(async (_e, items) => {
        const count = await db.importWalletsChunked(items, (done, total, inserted) => {
            mainWindow.webContents.send('event:wallet-import:progress', { done, total, inserted });
        });
        return count;
    }));
    // === Stream ===
    electron_1.ipcMain.handle('stream:start', handlerAsync(async () => { await streamWorker.start(); }));
    electron_1.ipcMain.handle('stream:stop', handlerAsync(async () => { await streamWorker.stop(); }));
    electron_1.ipcMain.handle('stream:refresh', handlerAsync(async () => { await streamWorker.refreshWallets(); }));
    // === Backfill ===
    electron_1.ipcMain.handle('backfill:start', handlerAsync(async (_e, s, e) => { await backfillWorker.start(s, e); }));
    electron_1.ipcMain.handle('backfill:pause', handler(() => { backfillWorker.pause(); }));
    electron_1.ipcMain.handle('backfill:resume', handler(() => { backfillWorker.resume(); }));
    electron_1.ipcMain.handle('backfill:stop', handlerAsync(async () => { await backfillWorker.stop(); }));
    // === Price ===
    electron_1.ipcMain.handle('price:get', handler(() => priceService.getPrice()));
    // === Wire workers to push events ===
    streamWorker.onTrade((trade) => mainWindow.webContents.send('event:trade', trade));
    streamWorker.onStatus((status) => mainWindow.webContents.send('event:stream:status', status));
    backfillWorker.onProgress((data) => mainWindow.webContents.send('event:backfill:progress', data));
    backfillWorker.onStatus((msg) => mainWindow.webContents.send('event:backfill:status', msg));
    priceService.onPrice((price) => mainWindow.webContents.send('event:sol:price', price));
}
