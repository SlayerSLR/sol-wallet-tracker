import { ipcMain, BrowserWindow, shell, clipboard } from 'electron';
import * as db from './database.js';
import { StreamWorker } from './stream-worker.js';
import { BackfillWorker } from './backfill-worker.js';
import { SolPriceService } from './price-service.js';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(error: string) { return { ok: false as const, error }; }

function handler<T>(fn: (...args: any[]) => T) {
  return (...args: any[]) => {
    try { return ok(fn(...args)); }
    catch (e: any) { return err(e?.message || String(e)); }
  };
}

function handlerAsync<T>(fn: (...args: any[]) => Promise<T>) {
  return async (...args: any[]) => {
    try { return ok(await fn(...args)); }
    catch (e: any) { return err(e?.message || String(e)); }
  };
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  streamWorker: StreamWorker,
  backfillWorker: BackfillWorker,
  priceService: SolPriceService,
): void {
  // === DB handlers (standardized {ok, data/error}) ===
  ipcMain.handle('db:stats',           handler(() => db.getDashboardStats()));
  ipcMain.handle('db:trades:recent',   handler((_e: any, limit: number) => db.getRecentTrades(limit)));
  ipcMain.handle('db:traders:top',     handler((_e: any, limit: number) => db.getTopTradersByVolume(limit)));
  ipcMain.handle('db:tokens:top',      handler((_e: any, limit: number) => db.getTopTokensByVolume(limit)));
  ipcMain.handle('db:tokens:overlap',  handler((_e: any, min: number, limit: number) => db.getOverlappingTokens(min, limit)));
  ipcMain.handle('db:wallet:stats',    handler((_e: any, addr: string) => db.getWalletStats(addr)));
  ipcMain.handle('db:wallet:trades',   handler((_e: any, addr: string, limit: number) => db.getWalletTrades(addr, limit)));
  ipcMain.handle('db:pnl:get',         handler((_e: any, addr: string | null) => db.getWalletPnL(addr ?? undefined)));
  ipcMain.handle('db:token:stats',     handler((_e: any, mint: string) => db.getTokenStats(mint)));
  ipcMain.handle('db:token:trades',    handler((_e: any, mint: string, limit: number) => db.getTokenTrades(mint, limit)));
  ipcMain.handle('db:tokens:list',     handler(() => db.getTokens()));
  ipcMain.handle('db:wallets:list',    handler(() => db.getWallets()));
  ipcMain.handle('db:wallet:add',      handler((_e: any, addr: string, label: string, tags: string) => db.addWallet(addr, label, tags)));
  ipcMain.handle('db:wallets:import',  handler((_e: any, items: any) => db.importWallets(items)));
  ipcMain.handle('db:wallet:remove',   handler((_e: any, addr: string) => { db.removeWallet(addr); }));
  ipcMain.handle('db:wallet:update',   handler((_e: any, addr: string, label: string, tags: string) => { db.updateWallet(addr, label, tags); }));
  ipcMain.handle('db:pnl:recompute',   handler(() => { db.recomputeAllPnL(); }));
  ipcMain.handle('db:backfill:progress', handler(() => db.getBackfillProgress()));
  ipcMain.handle('db:wallets:import-chunked', handlerAsync(async (_e: any, items: any) => {
    const count = await db.importWalletsChunked(items, (done, total, inserted) => {
      mainWindow.webContents.send('event:wallet-import:progress', { done, total, inserted });
    });
    return count;
  }));

  // === Stream ===
  ipcMain.handle('stream:start',   handlerAsync(async () => { await streamWorker.start(); }));
  ipcMain.handle('stream:stop',    handlerAsync(async () => { await streamWorker.stop(); }));
  ipcMain.handle('stream:refresh', handlerAsync(async () => { await streamWorker.refreshWallets(); }));

  // === Backfill ===
  ipcMain.handle('backfill:start',  handlerAsync(async (_e: any, s: string, e: string) => { await backfillWorker.start(s, e); }));
  ipcMain.handle('backfill:pause',  handler(() => { backfillWorker.pause(); }));
  ipcMain.handle('backfill:resume', handler(() => { backfillWorker.resume(); }));
  ipcMain.handle('backfill:stop',   handlerAsync(async () => { await backfillWorker.stop(); }));
  ipcMain.handle('backfill:process-cache', handlerAsync(async (_e: any, s: string, e: string) => { await backfillWorker.processFromCache(s, e); }));
  ipcMain.handle('backfill:process-cache-all', handlerAsync(async () => { await backfillWorker.processAllFromCache(); }));
  ipcMain.handle('cache:set-dir',   handler((_e: any, dir: string) => { backfillWorker.setCacheDir(dir); }));
  ipcMain.handle('cache:get-dir',   handler(() => backfillWorker.getCacheDir()));
  ipcMain.handle('cache:scan',      handler(() => backfillWorker.scanCache()));

  // === Price ===
  ipcMain.handle('price:get', handler(() => priceService.getPrice()));

  // === Clipboard ===
  ipcMain.handle('clipboard:copy', handler((_e: any, text: string) => { clipboard.writeText(text); }));

  // === Shell ===
  ipcMain.handle('open:external', handler((_e: any, url: string) => { shell.openExternal(url); }));

  // === Wire workers to push events ===
  streamWorker.onTrade((trade) => mainWindow.webContents.send('event:trade', trade));
  streamWorker.onStatus((status) => mainWindow.webContents.send('event:stream:status', status));
  backfillWorker.onProgress((data) => mainWindow.webContents.send('event:backfill:progress', data));
  backfillWorker.onStatus((msg) => mainWindow.webContents.send('event:backfill:status', msg));
  priceService.onPrice((price) => mainWindow.webContents.send('event:sol:price', price));
}
