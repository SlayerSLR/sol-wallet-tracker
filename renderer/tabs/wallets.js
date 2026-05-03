window.Wallets = {
  html() { return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <label style="font-size:12px">Wallet:</label>
      <select id="w-select" style="flex:1;max-width:420px"><option>Loading...</option></select>
      <button class="btn" id="w-refresh">Refresh</button>
    </div>
    <div id="w-stats" class="card" style="font-size:11px;max-height:100px;overflow:auto;white-space:pre;margin-bottom:8px">Select a wallet above</div>
    <div id="w-chart" style="height:180px;margin-bottom:8px"></div>
    <div style="overflow:auto;max-height:calc(100vh - 460px)">
      <table id="w-table"><thead><tr>
        <th>Time</th><th>Type</th><th>Token</th><th>Token Amt</th><th>SOL Amt</th><th>Price (SOL)</th><th>Market Cap</th><th>Pool</th><th>Signature</th>
      </tr></thead><tbody></tbody></table>
    </div>
  `; },

  init() {
    this._loadWallets();
    document.getElementById('w-refresh').onclick = () => this._loadWalletData();
    document.getElementById('w-select').onchange = () => { this._loadWalletData(); };
  },

  async _loadWallets() {
    const r = await window.api.db.getWallets();
    const wallets = r.ok ? r.data : [];
    const sel = document.getElementById('w-select');
    sel.innerHTML = wallets.map(w => `<option value="${w.address}">${w.address}${w.label ? ' [' + w.label + ']' : ''}</option>`).join('');
    if (wallets.length) this._loadWalletData();
  },

  async _loadWalletData() {
    const addr = document.getElementById('w-select').value;
    if (!addr) return;
    const [statsR, tradesR, pnlR] = await Promise.all([
      window.api.db.getWalletStats(addr),
      window.api.db.getWalletTrades(addr, 200),
      window.api.db.getWalletPnL(addr),
    ]);
    const stats = statsR.ok ? statsR.data : {};
    const trades = tradesR.ok ? tradesR.data : [];
    const pnl = pnlR.ok ? pnlR.data : [];
    const U = window.TableUtils, p = window.solPrice || 0;
    const avgBuy = stats.avg_buy_price || 0, avgSell = stats.avg_sell_price || 0;
    const buyVol = stats.total_buy_volume || 0, sellVol = stats.total_sell_volume || 0;
    const realized = pnl.reduce((sum, x) => sum + (x.realized_pnl || 0), 0);

    document.getElementById('w-stats').textContent =
      `Total Trades: ${stats.total_trades||0}  |  Buys: ${stats.buys||0}  |  Sells: ${stats.sells||0}\n` +
      `Buy Volume: ${U.formatSOL(buyVol)} SOL (~${U.formatUSD(buyVol*p)})  |  Sell Volume: ${U.formatSOL(sellVol)} SOL (~${U.formatUSD(sellVol*p)})\n` +
      `Unique Tokens: ${stats.unique_tokens||0}  |  Avg Buy Price: ${avgBuy.toFixed(8)}  |  Avg Sell Price: ${avgSell.toFixed(8)}\n` +
      (stats.first_trade ? `First Trade: ${U.formatShortTime(stats.first_trade)}  |  Last Trade: ${U.formatShortTime(stats.last_trade)}\n` : '') +
      `Total Realized PnL: ${realized >= 0 ? '+' : ''}${U.formatSOL(realized)} SOL (~${U.formatUSD(realized*p)})  |  Token Pairs: ${pnl.length}`;

    let html = '';
    for (const t of trades) {
      html += `<tr class="${t.tx_type === 'buy' ? 'buy' : 'sell'}">
        <td>${U.formatTime(t.timestamp)}</td><td>${t.tx_type}</td><td>${U.shortAddr(t.mint,10)}</td>
        <td>${U.formatShortSOL(t.token_amount)}</td><td>${U.formatShortSOL(t.sol_amount)}</td>
        <td>${(t.price||0).toFixed(8)}</td><td>${U.formatShortSOL(t.market_cap_sol)}</td>
        <td>${t.pool||''}</td><td>${U.shortAddr(t.signature,8)}</td></tr>`;
    }
    document.querySelector('#w-table tbody').innerHTML = html;

    // PnL chart
    const sorted = [...pnl].sort((a,b) => (b.realized_pnl||0) - (a.realized_pnl||0));
    window.EChartUtils.barChart(document.getElementById('w-chart'), 'PnL by Token',
      sorted.map(x => U.shortAddr(x.mint,8)), sorted.map(x => x.realized_pnl||0), '#00d4aa');
  },

  destroy() {
    try { window.EChartUtils.disposeAll(document.getElementById('w-chart')); } catch {}
  },
};
