"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamWorker = void 0;
const ws_1 = __importDefault(require("ws"));
const database_js_1 = require("./database.js");
const STREAM_URL = 'wss://stream.pumpapi.io';
const KNOWN_POOLS = ['pump', 'pump-amm', 'raydium-launchpad', 'raydium-cpmm', 'meteora-launchpad', 'meteora-damm-v1', 'meteora-damm-v2'];
function parseFloatSafe(v) {
    if (v == null)
        return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function safePool(val) {
    if (!val)
        return null;
    return KNOWN_POOLS.includes(val) ? val : null;
}
class StreamWorker {
    _running = false;
    _connected = false;
    _ws = null;
    _walletSet = new Set();
    _tradeCount = 0;
    _statusCb = null;
    _tradeCb = null;
    _refreshInterval = 30000;
    _lastRefresh = 0;
    get isConnected() { return this._connected; }
    get isRunning() { return this._running; }
    get tradeCount() { return this._tradeCount; }
    onStatus(cb) { this._statusCb = cb; }
    onTrade(cb) { this._tradeCb = cb; }
    async start() {
        if (this._running)
            return;
        this._running = true;
        this._walletSet = (0, database_js_1.getWalletSet)();
        this._lastRefresh = Date.now();
        this._connect();
    }
    async stop() {
        this._running = false;
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }
        this._connected = false;
    }
    async refreshWallets() {
        this._walletSet = (0, database_js_1.getWalletSet)();
    }
    _connect() {
        if (!this._running)
            return;
        this._notifyStatus('Connecting...');
        const ws = new ws_1.default(STREAM_URL);
        this._ws = ws;
        ws.on('open', () => {
            this._connected = true;
            this._notifyStatus(`Connected (${this._walletSet.size} wallets, ${this._tradeCount} trades captured)`);
        });
        ws.on('message', (data) => {
            try {
                this._handleMessage(data.toString());
            }
            catch (e) {
                console.error('Stream message handler error:', e);
            }
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
    _handleMessage(raw) {
        if (Date.now() - this._lastRefresh > this._refreshInterval) {
            this._walletSet = (0, database_js_1.getWalletSet)();
            this._lastRefresh = Date.now();
        }
        let data;
        try {
            data = JSON.parse(raw);
        }
        catch {
            return;
        }
        const txType = data.txType;
        if (txType !== 'buy' && txType !== 'sell' && txType !== 'create')
            return;
        if (txType === 'create') {
            this._handleCreate(data);
            return;
        }
        const traders = data.tradersInvolved || {};
        const traderKeys = Object.keys(traders);
        if (!traderKeys.length)
            return;
        const matches = traderKeys.filter(k => this._walletSet.has(k));
        if (!matches.length)
            return;
        for (const walletAddr of matches) {
            const solAmount = data.solAmount != null ? parseFloatSafe(data.solAmount) : (data.quoteAmount != null ? parseFloatSafe(data.quoteAmount) : 0);
            (0, database_js_1.insertTrade)({
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
    _handleCreate(data) {
        if (data.mint) {
            (0, database_js_1.insertToken)({
                mint: data.mint, name: data.name || null, symbol: data.symbol || null,
                supply: data.supply || null, createdAt: data.timestamp || null,
                creatorAddress: data.txSigner || null, poolId: data.poolId || null,
                pool: safePool(data.pool), marketCapSol: data.marketCapSol || null,
                price: data.price || null, tokenProgram: data.tokenProgram || null,
                decimals: data.decimals || null,
            });
        }
    }
    _notifyStatus(msg) { if (this._statusCb)
        this._statusCb(msg); }
}
exports.StreamWorker = StreamWorker;
