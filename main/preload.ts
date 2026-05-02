import { contextBridge, ipcRenderer } from 'electron';
import type { StreamTrade } from './stream-worker.js';
import type { BackfillProgressData } from './backfill-worker.js';

export type ApiResult<T> = { ok: true; data: T; } | { ok: false; error: string; };

contextBridge.exposeInMainWorld('api', {
  db: {
    getDashboardStats:       () => ipcRenderer.invoke('db:stats'),
    getRecentTrades:         (limit: number) => ipcRenderer.invoke('db:trades:recent', limit),
    getTopTradersByVolume:   (limit: number) => ipcRenderer.invoke('db:traders:top', limit),
    getTopTokensByVolume:    (limit: number) => ipcRenderer.invoke('db:tokens:top', limit),
    getOverlappingTokens:    (minWallets: number) => ipcRenderer.invoke('db:tokens:overlap', minWallets),
    getWalletStats:          (addr: string) => ipcRenderer.invoke('db:wallet:stats', addr),
    getWalletTrades:         (addr: string, limit: number) => ipcRenderer.invoke('db:wallet:trades', addr, limit),
    getWalletPnL:            (addr?: string) => ipcRenderer.invoke('db:pnl:get', addr ?? null),
    getTokenStats:           (mint: string) => ipcRenderer.invoke('db:token:stats', mint),
    getTokenTrades:          (mint: string, limit: number) => ipcRenderer.invoke('db:token:trades', mint, limit),
    getTokens:               () => ipcRenderer.invoke('db:tokens:list'),
    getWallets:              () => ipcRenderer.invoke('db:wallets:list'),
    addWallet:               (addr: string, label?: string, tags?: string) => ipcRenderer.invoke('db:wallet:add', addr, label ?? '', tags ?? ''),
    importWallets:           (items: (string | [string, string?, string?])[]) => ipcRenderer.invoke('db:wallets:import', items),
    removeWallet:            (addr: string) => ipcRenderer.invoke('db:wallet:remove', addr),
    updateWallet:            (addr: string, label: string, tags: string) => ipcRenderer.invoke('db:wallet:update', addr, label, tags),
    recomputePnL:            () => ipcRenderer.invoke('db:pnl:recompute'),
    getBackfillProgress:     () => ipcRenderer.invoke('db:backfill:progress'),
    importWalletsChunked:    (items: (string | [string, string?, string?])[]) => ipcRenderer.invoke('db:wallets:import-chunked', items),
  },
  events: {
    onTrade:         (cb: (d: StreamTrade) => void) => { ipcRenderer.on('event:trade', (_e, d) => cb(d)); },
    onStreamStatus:  (cb: (d: string) => void) => { ipcRenderer.on('event:stream:status', (_e, d) => cb(d)); },
    onSolPrice:      (cb: (d: number) => void) => { ipcRenderer.on('event:sol:price', (_e, d) => cb(d)); },
    onBackfillProgress: (cb: (d: BackfillProgressData) => void) => { ipcRenderer.on('event:backfill:progress', (_e, d) => cb(d)); },
    onBackfillStatus:   (cb: (d: string) => void) => { ipcRenderer.on('event:backfill:status', (_e, d) => cb(d)); },
    onWalletImportProgress: (cb: (d: { done: number; total: number; inserted: number }) => void) => { ipcRenderer.on('event:wallet-import:progress', (_e, d) => cb(d)); },
  },
  stream: {
    start:    () => ipcRenderer.invoke('stream:start'),
    stop:     () => ipcRenderer.invoke('stream:stop'),
    refresh:  () => ipcRenderer.invoke('stream:refresh'),
  },
  backfill: {
    start:  (startDate: string, endDate: string) => ipcRenderer.invoke('backfill:start', startDate, endDate),
    pause:  () => ipcRenderer.invoke('backfill:pause'),
    resume: () => ipcRenderer.invoke('backfill:resume'),
    stop:   () => ipcRenderer.invoke('backfill:stop'),
    processCache: (startDate: string, endDate: string) => ipcRenderer.invoke('backfill:process-cache', startDate, endDate),
    processCacheAll: () => ipcRenderer.invoke('backfill:process-cache-all'),
  },
  cache: {
    setDir: (dir: string) => ipcRenderer.invoke('cache:set-dir', dir),
    getDir: () => ipcRenderer.invoke('cache:get-dir'),
    scan: () => ipcRenderer.invoke('cache:scan'),
  },
  price: {
    get: () => ipcRenderer.invoke('price:get'),
  },
  clipboard: {
    copy: (text: string) => ipcRenderer.invoke('clipboard:copy', text),
  },
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
});
