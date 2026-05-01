window.TokenOverlap = {
  html() { return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <label style="font-size:12px">Min Wallets:</label>
      <input type="number" id="to-min" value="2" min="2" max="100" style="width:60px">
      <button class="btn" id="to-refresh">Refresh</button>
      <span id="to-count" style="margin-left:auto;font-size:12px;color:#a0a0b0"></span>
    </div>
    <div style="overflow:auto;max-height:calc(100vh - 120px)">
      <table id="to-table"><thead><tr>
        <th>Token</th><th>Wallets</th><th>Trades</th><th>Volume</th><th>Market Cap</th><th>Traders</th><th>Last Trade</th>
      </tr></thead><tbody></tbody></table>
    </div>
    <div id="to-detail" style="margin-top:6px;font-size:11px;color:#a0a0b0"></div>
  `; },

  init() {
    document.getElementById('to-refresh').onclick = () => this._load();
    this._load();
  },

  async _load() {
    const min = parseInt(document.getElementById('to-min').value) || 2;
    document.getElementById('to-detail').textContent = `Loading tokens traded by at least ${min} wallet(s)...`;
    const r = await window.api.db.getOverlappingTokens(min);
    const rows = r.ok ? r.data : [];
    const U = window.TableUtils;
    const p = window.solPrice || 0;
    let html = '';
    for (const o of rows) {
      const traders = (o.trader_list || '').split(',');
      const short = traders.slice(0,6).map(t => {
        const a = t.trim();
        const name = window._walletNames[a] || '';
        return name ? `<span title="${a}">${name}</span>` : U.shortAddr(a, 6);
      }).join(', ') + (traders.length > 6 ? ` +${traders.length-6} more` : '');
      html += `<tr>
        <td style="cursor:pointer;color:#00d4aa" onclick="window.TokenOverlap._goToToken('${o.mint}')">${U.shortAddr(o.mint,12)}</td>
        <td>${o.wallet_count}</td><td>${o.trade_count}</td>
        <td>${U.formatShortSOL(o.buy_volume+o.sell_volume)} SOL (~${U.formatUSD((o.buy_volume+o.sell_volume)*p)})</td>
        <td>${U.formatMCAP(o.latest_market_cap, p)}</td>
        <td>${short}</td><td>${U.formatShortTime(o.last_trade)}</td></tr>`;
    }
    document.querySelector('#to-table tbody').innerHTML = html;
    document.getElementById('to-count').textContent = `${rows.length} tokens`;
    document.getElementById('to-detail').textContent = `Tokens traded by ≥${min} tracked wallets. SOL/USD: $${p.toFixed(2)}`;
  },

  _goToToken(mint) {
    document.querySelector('nav button[data-tab="tokens"]').click();
    setTimeout(() => { if (window.Tokens) window.Tokens._selectToken(mint); }, 200);
  },
};
