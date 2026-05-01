"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('api', {
    db: {
        getDashboardStats: () => electron_1.ipcRenderer.invoke('db:stats'),
        getRecentTrades: (limit) => electron_1.ipcRenderer.invoke('db:trades:recent', limit),
        getTopTradersByVolume: (limit) => electron_1.ipcRenderer.invoke('db:traders:top', limit),
        getTopTokensByVolume: (limit) => electron_1.ipcRenderer.invoke('db:tokens:top', limit),
        getOverlappingTokens: (minWallets) => electron_1.ipcRenderer.invoke('db:tokens:overlap', minWallets),
        getWalletStats: (addr) => electron_1.ipcRenderer.invoke('db:wallet:stats', addr),
        getWalletTrades: (addr, limit) => electron_1.ipcRenderer.invoke('db:wallet:trades', addr, limit),
        getWalletPnL: (addr) => electron_1.ipcRenderer.invoke('db:pnl:get', addr ?? null),
        getTokenStats: (mint) => electron_1.ipcRenderer.invoke('db:token:stats', mint),
        getTokenTrades: (mint, limit) => electron_1.ipcRenderer.invoke('db:token:trades', mint, limit),
        getTokens: () => electron_1.ipcRenderer.invoke('db:tokens:list'),
        getWallets: () => electron_1.ipcRenderer.invoke('db:wallets:list'),
        addWallet: (addr, label, tags) => electron_1.ipcRenderer.invoke('db:wallet:add', addr, label ?? '', tags ?? ''),
        importWallets: (items) => electron_1.ipcRenderer.invoke('db:wallets:import', items),
        removeWallet: (addr) => electron_1.ipcRenderer.invoke('db:wallet:remove', addr),
        updateWallet: (addr, label, tags) => electron_1.ipcRenderer.invoke('db:wallet:update', addr, label, tags),
        recomputePnL: () => electron_1.ipcRenderer.invoke('db:pnl:recompute'),
        getBackfillProgress: () => electron_1.ipcRenderer.invoke('db:backfill:progress'),
        importWalletsChunked: (items) => electron_1.ipcRenderer.invoke('db:wallets:import-chunked', items),
    },
    events: {
        onTrade: (cb) => { electron_1.ipcRenderer.on('event:trade', (_e, d) => cb(d)); },
        onStreamStatus: (cb) => { electron_1.ipcRenderer.on('event:stream:status', (_e, d) => cb(d)); },
        onSolPrice: (cb) => { electron_1.ipcRenderer.on('event:sol:price', (_e, d) => cb(d)); },
        onBackfillProgress: (cb) => { electron_1.ipcRenderer.on('event:backfill:progress', (_e, d) => cb(d)); },
        onBackfillStatus: (cb) => { electron_1.ipcRenderer.on('event:backfill:status', (_e, d) => cb(d)); },
        onWalletImportProgress: (cb) => { electron_1.ipcRenderer.on('event:wallet-import:progress', (_e, d) => cb(d)); },
    },
    stream: {
        start: () => electron_1.ipcRenderer.invoke('stream:start'),
        stop: () => electron_1.ipcRenderer.invoke('stream:stop'),
        refresh: () => electron_1.ipcRenderer.invoke('stream:refresh'),
    },
    backfill: {
        start: (startDate, endDate) => electron_1.ipcRenderer.invoke('backfill:start', startDate, endDate),
        pause: () => electron_1.ipcRenderer.invoke('backfill:pause'),
        resume: () => electron_1.ipcRenderer.invoke('backfill:resume'),
        stop: () => electron_1.ipcRenderer.invoke('backfill:stop'),
    },
    price: {
        get: () => electron_1.ipcRenderer.invoke('price:get'),
    },
});
