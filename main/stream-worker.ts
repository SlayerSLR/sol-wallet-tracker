import WebSocket from 'ws';
import { getWalletSet, insertTrade, getTokens, insertToken } from './database.js';

const STREAM_URL = 'wss://stream.pumpapi.io';
const KNOWN_POOLS = ['pump', 'pump-amm', 'raydium-launchpad', 'raydium-cpmm', 'meteora-launchpad', 'meteora-damm-v1', 'meteora-damm-v2'];

function parseFloatSafe(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safePool(val: string | null | undefined): string | null {
  if (!val) return null;
  return KNOWN_POOLS.includes(val) ? val : null;
}

export interface StreamTrade {
  signature: string; txType: string; walletAddress: string; mint: string;
  tokenAmount: number; solAmount: number; price: number; marketCapSol: number;
  pool: string | null; poolId: string | null; timestamp: number; block: number; priorityFee: number | null;
}

export class StreamWorker {
  private _running = false;
  private _connected = false;
  private _ws: WebSocket | null = null;
  private _walletSet = new Set<string>();
  private _tradeCount = 0;
  private _statusCb: ((s: string) => void) | null = null;
  private _tradeCb: ((t: StreamTrade) => void) | null = null;
  private _refreshInterval = 30000;
  private _lastRefresh = 0;

  get isConnected() { return this._connected; }
  get isRunning() { return this._running; }
  get tradeCount() { return this._tradeCount; }

  onStatus(cb: (s: string) => void) { this._statusCb = cb; }
  onTrade(cb: (t: StreamTrade) => void) { this._tradeCb = cb; }

  async start() {
    if (this._running) return;
    this._running = true;
    this._walletSet = getWalletSet();
    this._lastRefresh = Date.now();
    this._connect();
  }

  async stop() {
    this._running = false;
    if (this._ws) { this._ws.close(); this._ws = null; }
    this._connected = false;
  }

  async refreshWallets() {
    this._walletSet = getWalletSet();
  }

  private _connect() {
    if (!this._running) return;
    this._notifyStatus('Connecting...');
    const ws = new WebSocket(STREAM_URL);
    this._ws = ws;
    ws.on('open', () => {
      this._connected = true;
      this._notifyStatus(`Connected (${this._walletSet.size} wallets, ${this._tradeCount} trades captured)`);
    });
    ws.on('message', (data: WebSocket.RawData) => {
      try { this._handleMessage(data.toString()); } catch (e) { console.error('Stream message handler error:', e); }
    });
    ws.on('close', () => {
      this._connected = false;
      if (this._running) {
        this._notifyStatus('Disconnected, reconnecting in 2s...');
        setTimeout(() => this._connect(), 2000);
      }
    });
    ws.on('error', () => { this._connected = false; });
  }

  private _handleMessage(raw: string) {
    if (Date.now() - this._lastRefresh > this._refreshInterval) {
      this._walletSet = getWalletSet();
      this._lastRefresh = Date.now();
    }
    let data: any;
    try { data = JSON.parse(raw); } catch { return; }

    const txType = data.txType;
    if (txType !== 'buy' && txType !== 'sell' && txType !== 'create') return;

    if (txType === 'create') { this._handleCreate(data); return; }

    const traders: Record<string, unknown> = data.tradersInvolved || {};
    const traderKeys = Object.keys(traders);
    if (!traderKeys.length) return;

    const matches = traderKeys.filter(k => this._walletSet.has(k));
    if (!matches.length) return;

    for (const walletAddr of matches) {
      const solAmount = data.solAmount != null ? parseFloatSafe(data.solAmount) : (data.quoteAmount != null ? parseFloatSafe(data.quoteAmount) : 0);
      insertTrade({
        signature: data.signature || '', tx_type: txType, wallet_address: walletAddr, mint: data.mint || '',
        token_amount: parseFloatSafe(data.tokenAmount), sol_amount: solAmount,
        price: parseFloatSafe(data.price),
        market_cap_sol: data.marketCapSol != null ? parseFloatSafe(data.marketCapSol) : parseFloatSafe(data.marketCapQuote),
        pool: safePool(data.pool), pool_id: data.poolId || null, tx_signers: data.txSigner || '',
        quote_mint: data.quoteMint || null, quote_amount: data.quoteAmount != null ? parseFloatSafe(data.quoteAmount) : null,
        timestamp: parseInt(data.timestamp || '0', 10) || 0,
        block: parseInt(data.block || '0', 10) || 0,
        priority_fee: parseFloatSafe(data.priorityFee) || null,
      });
      this._tradeCount++;
    }

    if (this._tradeCb && matches.length) {
      for (const walletAddr of matches) {
        const solAmount = data.solAmount != null ? parseFloatSafe(data.solAmount) : (data.quoteAmount != null ? parseFloatSafe(data.quoteAmount) : 0);
        this._tradeCb({
          signature: data.signature || '', txType, walletAddress: walletAddr, mint: data.mint || '',
          tokenAmount: parseFloatSafe(data.tokenAmount), solAmount,
          price: parseFloatSafe(data.price),
          marketCapSol: data.marketCapSol != null ? parseFloatSafe(data.marketCapSol) : parseFloatSafe(data.marketCapQuote),
          pool: safePool(data.pool), poolId: data.poolId || null,
          timestamp: parseInt(data.timestamp || '0', 10) || 0,
          block: parseInt(data.block || '0', 10) || 0,
          priorityFee: parseFloatSafe(data.priorityFee) || null,
        });
      }
    }
  }

  private _handleCreate(data: any) {
    if (data.mint) {
      insertToken({
        mint: data.mint, name: data.name || null, symbol: data.symbol || null,
        supply: data.supply || null, createdAt: data.timestamp || null,
        creatorAddress: data.txSigner || null, poolId: data.poolId || null,
        pool: safePool(data.pool), marketCapSol: data.marketCapSol || null,
        price: data.price || null, tokenProgram: data.tokenProgram || null,
        decimals: data.decimals || null,
      });
    }
  }

  private _notifyStatus(msg: string) { if (this._statusCb) this._statusCb(msg); }
}
