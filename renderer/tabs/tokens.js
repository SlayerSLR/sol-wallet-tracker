window.Tokens = {
  html() { return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <label style="font-size:12px">Token:</label>
      <select id="t-select" style="flex:1;max-width:420px"><option>Loading...</option></select>
      <button class="btn" id="t-refresh">Refresh</button>
    </div>
    <div id="t-stats" class="card" style="font-size:11px;max-height:80px;overflow:auto;white-space:pre;margin-bottom:8px">Select a token above</div>
    <div id="t-chart" style="height:180px;margin-bottom:8px"></div>
    <div style="overflow:auto;max-height:calc(100vh - 540px)">
      <table id="t-trades"><thead><tr>
        <th>Time</th><th>Type</th><th>Wallet</th><th>Token Amt</th><th>SOL Amt</th><th>Price (SOL)</th><th>Market Cap</th><th>Pool</th><th>Signature</th>
      </tr></thead><tbody></tbody></table>
      <table id="t-wallets" style="margin-top:10px"><thead><tr>
        <th>Wallet</th><th>Buys</th><th>Sells</th><th>Net Volume (SOL)</th><th>Last Trade</th>
      </tr></thead><tbody></tbody></table>
    </div>
  `; },

  init() {
    this._loadTokens();
    document.getElementById('t-refresh').onclick = () => this._loadTokenData();
    document.getElementById('t-select').onchange = () => this._loadTokenData();
  },

  _selectToken(mint) {
    const sel = document.getElementById('t-select');
    for (const opt of sel.options) {
      if (opt.value === mint) { sel.value = mint; this._loadTokenData(); return; }
    }
  },

  async _loadTokens() {
    const r = await window.api.db.getTokens();
    const tokens = r.ok ? r.data : [];
    let html = '';
    for (const t of tokens) {
      html += `<option value="${t.mint}">${t.mint}${t.symbol ? ' [' + t.symbol + ']' : ''}</option>`;
    }
    document.getElementById('t-select').innerHTML = html || '<option>No tokens yet</option>';
    if (tokens.length) this._loadTokenData();
  },

  async _loadTokenData() {
    const mint = document.getElementById('t-select').value;
    if (!mint) return;
    const [statsR, tradesR] = await Promise.all([
      window.api.db.getTokenStats(mint),
      window.api.db.getTokenTrades(mint, 200),
    ]);
    const stats = statsR.ok ? statsR.data : {};
    const trades = tradesR.ok ? tradesR.data : [];
    const U = window.TableUtils, p = window.solPrice || 0;
    const buyVol = stats.buy_volume || 0, sellVol = stats.sell_volume || 0;
    const avgMC = stats.avg_market_cap || 0, peakMC = stats.peak_market_cap || 0;

    document.getElementById('t-stats').textContent =
      `Total Trades: ${stats.total_trades||0}  |  Unique Wallets: ${stats.unique_wallets||0}\n` +
      `Buy Volume: ${U.formatSOL(buyVol)} SOL (~${U.formatUSD(buyVol*p)})  |  Sell Volume: ${U.formatSOL(sellVol)} SOL (~${U.formatUSD(sellVol*p)})\n` +
      `Avg Market Cap: ${U.formatMCAP(avgMC,p)}  |  Peak Market Cap: ${U.formatMCAP(peakMC,p)}`;

    let html = '';
    for (const t of trades) {
      html += `<tr class="${t.tx_type==='buy'?'buy':'sell'}">
        <td>${U.formatTime(t.timestamp)}</td><td>${t.tx_type}</td><td>${U.walletLabel(t.wallet_address)}</td>
        <td>${U.formatShortSOL(t.token_amount)}</td><td>${U.formatShortSOL(t.sol_amount)}</td>
        <td>${(t.price||0).toFixed(8)}</td><td>${U.formatShortSOL(t.market_cap_sol)}</td>
        <td>${t.pool||''}</td><td>${U.shortAddr(t.signature,8)}</td></tr>`;
    }
    document.querySelector('#t-trades tbody').innerHTML = html;

    // Price chart
    const sorted = [...trades].sort((a,b) => (a.timestamp||0) - (b.timestamp||0));
    window.EChartUtils.lineChart(document.getElementById('t-chart'), 'Price History',
      sorted.map(t => U.formatTime(t.timestamp)), sorted.map(t => t.price||0));

    // Wallet activity
    const wmap = {};
    for (const t of trades) {
      const a = t.wallet_address; if (!a) continue;
      if (!wmap[a]) wmap[a] = { buys:0, sells:0, net:0, last:0 };
      wmap[a][t.tx_type === 'buy' ? 'buys' : 'sells']++;
      wmap[a].net += t.tx_type === 'buy' ? (t.sol_amount||0) : -(t.sol_amount||0);
      wmap[a].last = Math.max(wmap[a].last, t.timestamp||0);
    }
    const wlist = Object.entries(wmap).sort((a,b) => b[1].net - a[1].net);
    html = '';
    for (const [w,u] of wlist) {
      html += `<tr><td>${U.walletLabel(w)}</td><td>${u.buys}</td><td>${u.sells}</td><td>${u.net>=0?'+':''}${U.formatSOL(u.net)}</td><td>${U.formatShortTime(u.last)}</td></tr>`;
    }
    document.querySelector('#t-wallets tbody').innerHTML = html;
  },
};
