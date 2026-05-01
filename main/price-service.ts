import https from 'node:https';

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112';

export class SolPriceService {
  private _price = 0;
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _priceCb: ((price: number) => void) | null = null;

  getPrice(): number { return this._price; }
  toUsd(solAmount: number): number { return solAmount * this._price; }
  onPrice(cb: (price: number) => void) { this._priceCb = cb; }

  start(): void {
    this._fetchPrice();
    this._interval = setInterval(() => this._fetchPrice(), 60000);
  }

  stop(): void {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  private _fetchPrice(): void {
    https.get(DEXSCREENER_URL, { headers: { 'Accept': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (c: string) => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const pairs: any[] = data.pairs || [];
          let bestPrice: number | null = null;
          let bestLiq = 0;
          for (const pair of pairs) {
            const quote = (pair.quoteToken?.symbol || '').toUpperCase();
            if (quote !== 'USDC') continue;
            const liq = parseFloat(pair.liquidity?.usd || '0');
            if (liq > bestLiq) {
              bestLiq = liq;
              bestPrice = parseFloat(pair.priceUsd || '0');
            }
          }
          if (bestPrice != null && bestPrice > 0) {
            this._price = bestPrice;
            if (this._priceCb) this._priceCb(bestPrice);
          }
        } catch (e) { console.warn('SolPriceService parse error:', e); }
      });
    }).on('error', (e) => { console.warn('SolPriceService fetch error:', e.message); });
  }
}
