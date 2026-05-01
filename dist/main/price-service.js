"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolPriceService = void 0;
const node_https_1 = __importDefault(require("node:https"));
const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112';
class SolPriceService {
    _price = 0;
    _interval = null;
    _priceCb = null;
    getPrice() { return this._price; }
    toUsd(solAmount) { return solAmount * this._price; }
    onPrice(cb) { this._priceCb = cb; }
    start() {
        this._fetchPrice();
        this._interval = setInterval(() => this._fetchPrice(), 60000);
    }
    stop() {
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }
    _fetchPrice() {
        node_https_1.default.get(DEXSCREENER_URL, { headers: { 'Accept': 'application/json' } }, (res) => {
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const pairs = data.pairs || [];
                    let bestPrice = null;
                    let bestLiq = 0;
                    for (const pair of pairs) {
                        const quote = (pair.quoteToken?.symbol || '').toUpperCase();
                        if (quote !== 'USDC')
                            continue;
                        const liq = parseFloat(pair.liquidity?.usd || '0');
                        if (liq > bestLiq) {
                            bestLiq = liq;
                            bestPrice = parseFloat(pair.priceUsd || '0');
                        }
                    }
                    if (bestPrice != null && bestPrice > 0) {
                        this._price = bestPrice;
                        if (this._priceCb)
                            this._priceCb(bestPrice);
                    }
                }
                catch (e) {
                    console.warn('SolPriceService parse error:', e);
                }
            });
        }).on('error', (e) => { console.warn('SolPriceService fetch error:', e.message); });
    }
}
exports.SolPriceService = SolPriceService;
