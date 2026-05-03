import { contextBridge, ipcRenderer } from 'electron';

// ====== BackendClient (inlined — Electron sandbox can't resolve cross-file imports) ======

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

class BackendClient {
  private _baseUrl: string;
  private _wsUrl: string;
  private _ws: WebSocket | null = null;
  private _listeners: Map<string, Set<(...args: any[]) => void>> = new Map();
  private _reconnectDelay = 1000;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  constructor(port: number) {
    this._baseUrl = `http://127.0.0.1:${port}`;
    this._wsUrl = `ws://127.0.0.1:${port}/ws`;
  }

  connectWs() {
    if (this._destroyed) return;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._ws = new WebSocket(this._wsUrl);
    this._ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string);
        const handlers = this._listeners.get(msg.type);
        if (handlers) {
          for (const cb of handlers) cb(msg.data);
        }
      } catch { /* ignore malformed WS messages */ }
    };
    this._ws.onclose = () => {
      if (!this._destroyed) {
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
        this._reconnectTimer = setTimeout(() => this.connectWs(), this._reconnectDelay);
      }
    };
    this._ws.onopen = () => {
      this._reconnectDelay = 1000;
    };
    this._ws.onerror = () => { /* onclose handles reconnection */ };
  }

  on(type: string, cb: (...args: any[]) => void) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(cb);
  }

  off(type: string, cb: (...args: any[]) => void) {
    this._listeners.get(type)?.delete(cb);
  }

  destroy() {
    this._destroyed = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.onmessage = null;
      this._ws.onerror = null;
      this._ws.close();
      this._ws = null;
    }
    this._listeners.clear();
  }

  async get<T>(path: string): Promise<ApiResult<T>> {
    try {
      const resp = await fetch(this._baseUrl + path);
      return (await resp.json()) as ApiResult<T>;
    } catch (e: any) { return { ok: false, error: e.message }; }
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    try {
      const resp = await fetch(this._baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body != null ? JSON.stringify(body) : undefined,
      });
      return (await resp.json()) as ApiResult<T>;
    } catch (e: any) { return { ok: false, error: e.message }; }
  }

  async del<T>(path: string): Promise<ApiResult<T>> {
    try {
      const resp = await fetch(this._baseUrl + path, { method: 'DELETE' });
      return (await resp.json()) as ApiResult<T>;
    } catch (e: any) { return { ok: false, error: e.message }; }
  }

  async patch<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    try {
      const resp = await fetch(this._baseUrl + path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: body != null ? JSON.stringify(body) : undefined,
      });
      return (await resp.json()) as ApiResult<T>;
    } catch (e: any) { return { ok: false, error: e.message }; }
  }
}

// ====== Wire up ======

const portArg = process.argv.find(a => a.startsWith('--backend-port='));
const port = portArg ? parseInt(portArg.split('=')[1], 10) : 0;

const client = port ? new BackendClient(port) : null;

if (client) client.connectWs();

const safe = {
  get: <T>() => Promise.resolve({ ok: false as const, error: 'Backend not connected' } as ApiResult<T>),
  post: <T>() => Promise.resolve({ ok: false as const, error: 'Backend not connected' } as ApiResult<T>),
  del: <T>() => Promise.resolve({ ok: false as const, error: 'Backend not connected' } as ApiResult<T>),
  patch: <T>() => Promise.resolve({ ok: false as const, error: 'Backend not connected' } as ApiResult<T>),
};
const c = client || safe;

contextBridge.exposeInMainWorld('api', {
  db: {
    getDashboardStats:       () => c.get('/api/stats'),
    getRecentTrades:         (limit: number) => c.get(`/api/trades/recent?limit=${limit}`),
    getTopTradersByVolume:   (limit: number) => c.get(`/api/traders/top?limit=${limit}`),
    getTopTokensByVolume:    (limit: number) => c.get(`/api/tokens/top?limit=${limit}`),
    getOverlappingTokens:    (minWallets: number, limit = 200) => c.get(`/api/tokens/overlap?min=${minWallets}&limit=${limit}`),
    getWalletStats:          (addr: string) => c.get(`/api/wallets/${encodeURIComponent(addr)}/stats`),
    getWalletTrades:         (addr: string, limit: number) => c.get(`/api/wallets/${encodeURIComponent(addr)}/trades?limit=${limit}`),
    getWalletPnL:            (addr?: string) => c.get(`/api/pnl${addr ? `?addr=${encodeURIComponent(addr)}` : ''}`),
    getTokenStats:           (mint: string) => c.get(`/api/tokens/${encodeURIComponent(mint)}/stats`),
    getTokenTrades:          (mint: string, limit: number) => c.get(`/api/tokens/${encodeURIComponent(mint)}/trades?limit=${limit}`),
    getTokens:               () => c.get('/api/tokens'),
    getWallets:              () => c.get('/api/wallets'),
    addWallet:               (addr: string, label?: string, tags?: string) => c.post('/api/wallets', { address: addr, label: label ?? '', tags: tags ?? '' }),
    importWallets:           (items: any) => c.post('/api/wallets/import', { items }),
    importWalletsChunked:    (items: any) => c.post('/api/wallets/import-chunked', { items }),
    removeWallet:            (addr: string) => c.del(`/api/wallets/${encodeURIComponent(addr)}`),
    updateWallet:            (addr: string, label: string, tags: string) => c.patch(`/api/wallets/${encodeURIComponent(addr)}`, { label, tags }),
    recomputePnL:            () => c.post('/api/pnl/recompute'),
    getBackfillProgress:     () => c.get('/api/backfill/progress'),
  },
  events: {
    onTrade:         (cb: (d: any) => void) => { if (!client) return () => {}; const w = (data: any[]) => data.forEach(cb); client.on('trades', w); return () => client.off('trades', w); },
    onStreamStatus:  (cb: (d: string) => void) => { if (!client) return () => {}; client.on('stream-status', cb); return () => client.off('stream-status', cb); },
    onSolPrice:      (cb: (d: number) => void) => { if (!client) return () => {}; client.on('sol-price', cb); return () => client.off('sol-price', cb); },
    onBackfillProgress: (cb: (d: any) => void) => { if (!client) return () => {}; client.on('backfill-progress', cb); return () => client.off('backfill-progress', cb); },
    onBackfillStatus:   (cb: (d: string) => void) => { if (!client) return () => {}; client.on('backfill-status', cb); return () => client.off('backfill-status', cb); },
    onWalletImportProgress: (cb: (d: { done: number; total: number; inserted: number }) => void) => { if (!client) return () => {}; client.on('wallet-import-progress', cb); return () => client.off('wallet-import-progress', cb); },
  },
  stream: {
    start:    () => c.post('/api/stream/start'),
    stop:     () => c.post('/api/stream/stop'),
    refresh:  () => c.post('/api/stream/refresh'),
  },
  backfill: {
    start:  (startDate: string, endDate: string) => c.post('/api/backfill/start', { startDate, endDate }),
    pause:  () => c.post('/api/backfill/pause'),
    resume: () => c.post('/api/backfill/resume'),
    stop:   () => c.post('/api/backfill/stop'),
    processCache: (startDate: string, endDate: string) => c.post('/api/backfill/process-cache', { startDate, endDate }),
    processCacheAll: () => c.post('/api/backfill/process-cache-all'),
  },
  cache: {
    setDir: (dir: string) => c.post('/api/cache/set-dir', { dir }),
    getDir: () => c.get('/api/cache/get-dir'),
    scan: () => c.get('/api/cache/scan'),
  },
  price: {
    get: () => c.get('/api/price'),
  },
  clipboard: {
    copy: (text: string) => ipcRenderer.invoke('local:clipboard:copy', text),
  },
  openExternal: (url: string) => ipcRenderer.invoke('local:open-external', url),
});
