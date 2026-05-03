import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { StreamTrade } from '../main/stream-worker.js';
import type { BackfillProgressData } from '../main/backfill-worker.js';

export interface WsEnvelope<T = unknown> {
  v: number;
  type: string;
  data: T;
  ts: number;
}

const MAX_BUFFERED = 1_000_000;

export class EventBus {
  private _wss: WebSocketServer;
  private _tradeBatcher: TradeBatcher;

  constructor(server: Server) {
    this._wss = new WebSocketServer({ server, path: '/ws' });
    this._tradeBatcher = new TradeBatcher((batch) => this._broadcast('trades', batch));
  }

  pushTrade(t: StreamTrade) { this._tradeBatcher.push(t); }
  pushStreamStatus(s: string) { this._broadcast('stream-status', s); }
  pushBackfillProgress(d: BackfillProgressData) { this._broadcast('backfill-progress', d); }
  pushBackfillStatus(m: string) { this._broadcast('backfill-status', m); }
  pushSolPrice(p: number) { this._broadcast('sol-price', p); }
  pushWalletImportProgress(d: { done: number; total: number; inserted: number }) { this._broadcast('wallet-import-progress', d); }

  private _broadcast(type: string, data: unknown) {
    const payload = JSON.stringify({ v: 1, type, data, ts: Date.now() } satisfies WsEnvelope);
    for (const client of this._wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > MAX_BUFFERED) { client.close(); continue; }
      client.send(payload);
    }
  }
}

class TradeBatcher {
  private _batch: StreamTrade[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastFlush = Date.now();
  private _sender: (batch: StreamTrade[]) => void;

  constructor(sender: (batch: StreamTrade[]) => void) {
    this._sender = sender;
  }

  push(t: StreamTrade) {
    this._batch.push(t);
    if (this._batch.length >= 200) { this._flush(); return; }
    if (this._batch.length >= 50) { this._flush(); return; }
    if (!this._flushTimer) this._schedule();
  }

  private _schedule() {
    const elapsed = Date.now() - this._lastFlush;
    const delay = Math.max(1, 50 - elapsed);
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flush();
    }, delay);
  }

  private _flush() {
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    if (this._batch.length === 0) return;
    const toSend = this._batch;
    this._batch = [];
    this._lastFlush = Date.now();
    this._sender(toSend);
  }
}
