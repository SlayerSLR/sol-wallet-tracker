"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackfillWorker = void 0;
exports.generateHourKeys = generateHourKeys;
const node_https_1 = __importDefault(require("node:https"));
const node_child_process_1 = require("node:child_process");
const database_js_1 = require("./database.js");
const REPLAY_BASE = 'https://replay.pumpapi.io';
const KNOWN_POOLS = ['pump', 'pump-amm', 'raydium-launchpad', 'raydium-cpmm', 'meteora-launchpad', 'meteora-damm-v1', 'meteora-damm-v2'];
function safePoolBf(val) {
    if (!val)
        return null;
    return KNOWN_POOLS.includes(val) ? val : null;
}
function parseFloatSafe(v) {
    if (v == null)
        return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
class BackfillWorker {
    _running = false;
    _paused = false;
    _progressCb = null;
    _statusCb = null;
    onProgress(cb) { this._progressCb = cb; }
    onStatus(cb) { this._statusCb = cb; }
    pause() { this._paused = true; }
    resume() { this._paused = false; }
    async stop() { this._running = false; this._paused = false; }
    async start(startDate, endDate) {
        if (this._running)
            return;
        this._running = true;
        this._paused = false;
        this._runBackfill(startDate, endDate);
    }
    _notifyStatus(msg) { if (this._statusCb)
        this._statusCb(msg); }
    _notifyProgress(d) { if (this._progressCb)
        this._progressCb(d); }
    _runBackfill(startDate, endDate) {
        const walletSet = (0, database_js_1.getWalletSet)();
        if (walletSet.size === 0) {
            this._notifyStatus('No wallets tracked. Add wallets before backfilling.');
            this._running = false;
            return;
        }
        const hourKeys = generateHourKeys(startDate, endDate);
        const totalHours = hourKeys.length;
        let completedHours = 0;
        let totalMatchedAll = 0;
        const processNext = (idx) => {
            if (!this._running || idx >= hourKeys.length) {
                this._notifyStatus(`Backfill complete. ${totalMatchedAll} trades matched.`);
                this._running = false;
                return;
            }
            if (this._paused) {
                setTimeout(() => processNext(idx), 500);
                return;
            }
            const hourKey = hourKeys[idx];
            if ((0, database_js_1.isBackfillComplete)(hourKey)) {
                completedHours++;
                this._notifyProgress({ completed: completedHours, total: totalHours, currentHour: hourKey, totalEvents: 0, matched: 0, skipped: true, percent: Math.round(completedHours / totalHours * 100) });
                setImmediate(() => processNext(idx + 1));
                return;
            }
            this._notifyStatus(`Downloading ${hourKey}...`);
            const url = `${REPLAY_BASE}/${hourKey}.jsonl.zst`;
            downloadAndProcess(url, hourKey, walletSet)
                .then(({ events: eventsTotal, matched: eventsMatched }) => {
                (0, database_js_1.setBackfillProgress)(hourKey, 'complete', eventsTotal, eventsMatched);
                totalMatchedAll += eventsMatched;
                completedHours++;
                this._notifyProgress({ completed: completedHours, total: totalHours, currentHour: hourKey, totalEvents: eventsTotal, matched: eventsMatched, skipped: false, percent: Math.round(completedHours / totalHours * 100) });
                setImmediate(() => processNext(idx + 1));
            })
                .catch((err) => {
                console.warn(`Backfill failed for ${hourKey}: ${err.message}`);
                (0, database_js_1.setBackfillProgress)(hourKey, 'failed', 0, 0);
                completedHours++;
                this._notifyProgress({ completed: completedHours, total: totalHours, currentHour: hourKey, totalEvents: 0, matched: 0, skipped: false, percent: Math.round(completedHours / totalHours * 100) });
                setImmediate(() => processNext(idx + 1));
            });
        };
        setImmediate(() => processNext(0));
    }
}
exports.BackfillWorker = BackfillWorker;
function generateHourKeys(startDate, endDate) {
    const keys = [];
    const current = new Date(startDate);
    current.setMinutes(0, 0, 0);
    const end = new Date(endDate);
    while (current < end) {
        const pad = (n) => String(n).padStart(2, '0');
        keys.push(`${current.getUTCFullYear()}/${pad(current.getUTCMonth() + 1)}/${pad(current.getUTCDate())}/${pad(current.getUTCHours())}`);
        current.setHours(current.getHours() + 1);
    }
    return keys;
}
function downloadAndProcess(url, _hourKey, walletSet) {
    return new Promise((resolve, reject) => {
        node_https_1.default.get(url, { timeout: 120000 }, (res) => {
            if (res.statusCode === 404) {
                res.resume();
                resolve({ events: 0, matched: 0 });
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const zstd = (0, node_child_process_1.spawn)('zstd', ['-d', '--stdout', '--no-progress']);
            if (!zstd.stdin || !zstd.stdout) {
                reject(new Error('zstd has no stdin/stdout'));
                return;
            }
            let stderrBuf = '';
            zstd.stderr?.on('data', (chunk) => { stderrBuf += chunk.toString(); });
            res.pipe(zstd.stdin);
            let buffer = '';
            let eventsTotal = 0;
            let eventsMatched = 0;
            const batch = [];
            zstd.stdout.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    eventsTotal++;
                    const trades = parseLine(line, walletSet);
                    for (const t of trades) {
                        batch.push(t);
                        eventsMatched++;
                    }
                    if (batch.length >= 500) {
                        flushBatch(batch);
                        batch.length = 0;
                    }
                }
            });
            zstd.stdout.on('end', () => {
                if (buffer.trim()) {
                    eventsTotal++;
                    const trades = parseLine(buffer, walletSet);
                    for (const t of trades) {
                        batch.push(t);
                        eventsMatched++;
                    }
                }
                if (batch.length)
                    flushBatch(batch);
                if (stderrBuf.trim())
                    console.warn(`zstd stderr for ${_hourKey}: ${stderrBuf.trim()}`);
                resolve({ events: eventsTotal, matched: eventsMatched });
            });
            zstd.on('error', (e) => {
                if (stderrBuf.trim())
                    console.warn(`zstd stderr before error for ${_hourKey}: ${stderrBuf.trim()}`);
                reject(e);
            });
            res.on('error', (e) => reject(e));
        }).on('error', (e) => reject(e));
    });
}
function parseLine(line, walletSet) {
    let data;
    try {
        data = JSON.parse(line);
    }
    catch {
        return [];
    }
    const txType = data.txType;
    if (txType !== 'buy' && txType !== 'sell')
        return [];
    const traders = data.tradersInvolved || {};
    const traderKeys = Object.keys(traders);
    if (!traderKeys.length)
        return [];
    const matches = traderKeys.filter(k => walletSet.has(k));
    if (!matches.length)
        return [];
    const solAmount = data.solAmount != null ? parseFloatSafe(data.solAmount) : parseFloatSafe(data.quoteAmount);
    return matches.map(walletAddr => ({
        signature: data.signature || '', tx_type: txType, wallet_address: walletAddr, mint: data.mint || '',
        token_amount: parseFloatSafe(data.tokenAmount), sol_amount: solAmount,
        price: parseFloatSafe(data.price),
        market_cap_sol: data.marketCapSol != null ? parseFloatSafe(data.marketCapSol) : parseFloatSafe(data.marketCapQuote),
        pool: safePoolBf(data.pool), pool_id: data.poolId || null, tx_signers: data.txSigner || '',
        quote_mint: data.quoteMint || null, quote_amount: data.quoteAmount != null ? parseFloatSafe(data.quoteAmount) : null,
        timestamp: parseInt(data.timestamp || '0', 10) || 0,
        block: parseInt(data.block || '0', 10) || 0,
        priority_fee: parseFloatSafe(data.priorityFee) || null,
    }));
}
function flushBatch(batch) { for (const t of batch)
    (0, database_js_1.insertTrade)(t); }
