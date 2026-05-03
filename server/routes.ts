import { Router, type Request, type Response } from 'express';
import * as db from '../main/database.js';
import type { StreamWorker } from '../main/stream-worker.js';
import type { BackfillWorker } from '../main/backfill-worker.js';
import type { SolPriceService } from '../main/price-service.js';
import type { EventBus } from './ws-events.js';

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

function ok<T>(data: T): ApiResult<T> { return { ok: true, data }; }
function err(error: string): ApiResult<never> { return { ok: false, error }; }

function route<T>(fn: (req: Request) => T) {
  return (req: Request, res: Response) => {
    try { res.json(ok(fn(req))); }
    catch (e: any) { res.json(err(e?.message || String(e))); }
  };
}

function routeAsync<T>(fn: (req: Request) => Promise<T>) {
  return async (req: Request, res: Response) => {
    try { res.json(ok(await fn(req))); }
    catch (e: any) { res.json(err(e?.message || String(e))); }
  };
}

function q(raw: unknown): string { return Array.isArray(raw) ? raw[0] || '' : typeof raw === 'string' ? raw : ''; }

function clampLimit(raw: unknown, def: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

export function createRouter(
  streamWorker: StreamWorker,
  backfillWorker: BackfillWorker,
  priceService: SolPriceService,
  eventBus: EventBus,
): Router {
  const r = Router();

  // === Health ===
  r.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

  // === Stats ===
  r.get('/api/stats', route(() => db.getDashboardStats()));

  // === Trades ===
  r.get('/api/trades/recent', route((req) => db.getRecentTrades(clampLimit(q(req.query.limit), 50, 500))));

  // === Top lists ===
  r.get('/api/traders/top', route((req) => db.getTopTradersByVolume(clampLimit(q(req.query.limit), 20, 100))));
  r.get('/api/tokens/top', route((req) => db.getTopTokensByVolume(clampLimit(q(req.query.limit), 20, 100))));
  r.get('/api/tokens/overlap', route((req) => db.getOverlappingTokens(clampLimit(q(req.query.min), 2, 100), clampLimit(q(req.query.limit), 200, 500))));

  // === Wallet CRUD ===
  r.get('/api/wallets', route(() => db.getWallets()));
  r.post('/api/wallets', route((req) => db.addWallet(req.body.address, req.body.label, req.body.tags)));
  r.delete('/api/wallets/:addr', route((req) => { db.removeWallet(String(req.params.addr)); }));
  r.patch('/api/wallets/:addr', route((req) => { db.updateWallet(String(req.params.addr), req.body.label, req.body.tags); }));
  r.post('/api/wallets/import', route((req) => db.importWallets(req.body.items ?? [])));
  r.post('/api/wallets/import-chunked', routeAsync(async (req) => {
    const count = await db.importWalletsChunked(req.body.items ?? [],
      (done, total, inserted) => eventBus.pushWalletImportProgress({ done, total, inserted })
    );
    return count;
  }));

  // === Wallet details ===
  r.get('/api/wallets/:addr/stats', route((req) => db.getWalletStats(String(req.params.addr))));
  r.get('/api/wallets/:addr/trades', route((req) => db.getWalletTrades(String(req.params.addr), clampLimit(q(req.query.limit), 500, 1000))));

  // === Token details ===
  r.get('/api/tokens', route(() => db.getTokens().slice(0, 5000)));
  r.get('/api/tokens/:mint/stats', route((req) => db.getTokenStats(String(req.params.mint))));
  r.get('/api/tokens/:mint/trades', route((req) => db.getTokenTrades(String(req.params.mint), clampLimit(q(req.query.limit), 500, 1000))));

  // === PnL ===
  r.get('/api/pnl', route((req) => db.getWalletPnL(q(req.query.addr) || undefined)));
  r.post('/api/pnl/recompute', routeAsync((_req) => new Promise<void>((resolve) => {
    setImmediate(() => { db.recomputeAllPnL(); resolve(); });
  })));

  // === Backfill ===
  r.get('/api/backfill/progress', route(() => db.getBackfillProgress()));
  r.post('/api/backfill/start', routeAsync((req) => backfillWorker.start(req.body.startDate, req.body.endDate)));
  r.post('/api/backfill/pause', route(() => { backfillWorker.pause(); }));
  r.post('/api/backfill/resume', route(() => { backfillWorker.resume(); }));
  r.post('/api/backfill/stop', routeAsync(() => backfillWorker.stop()));
  r.post('/api/backfill/process-cache', routeAsync((req) => backfillWorker.processFromCache(req.body.startDate, req.body.endDate)));
  r.post('/api/backfill/process-cache-all', routeAsync(() => backfillWorker.processAllFromCache()));

  // === Cache ===
  r.post('/api/cache/set-dir', route((req) => { backfillWorker.setCacheDir(req.body.dir); }));
  r.get('/api/cache/get-dir', route(() => backfillWorker.getCacheDir()));
  r.get('/api/cache/scan', route(() => backfillWorker.scanCache()));

  // === Stream ===
  r.post('/api/stream/start', routeAsync(() => streamWorker.start()));
  r.post('/api/stream/stop', routeAsync(() => streamWorker.stop()));
  r.post('/api/stream/refresh', routeAsync(() => streamWorker.refreshWallets()));

  // === Price ===
  r.get('/api/price', route(() => priceService.getPrice()));

  return r;
}
