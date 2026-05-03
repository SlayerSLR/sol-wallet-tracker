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
        <th>Token</th><th>Wallets</th><th>Trades</th><th>Volume</th><th>Remaining</th><th>Market Cap</th><th>Entry MC</th><th>First Entry</th><th>Traders</th><th>Last Trade</th><th>GMGN</th>
      </tr></thead><tbody></tbody></table>
    </div>
    <div id="to-detail" style="margin-top:6px;font-size:11px;color:#a0a0b0"></div>
  `; },

  init() {
    this._destroyed = false;
    this._unsubs = [];
    document.getElementById('to-refresh').onclick = () => this._load();
    document.getElementById('to-table').addEventListener('click', (e) => {
      const token = e.target.closest('.click-token');
      if (token) { this._goToToken(token.dataset.mint); return; }
      const ca = e.target.closest('.click-ca');
      if (ca) { window.api.clipboard.copy(ca.dataset.mint); return; }
      const gmgn = e.target.closest('.gmgn-btn');
      if (gmgn) { this._openGMGN(gmgn); return; }
    });
    this._load();

    // Event-driven: refresh on trades, throttled to 5s
    this._lastLoad = 0;
    this._unsubs.push(window.api.events.onTrade(() => {
      if (this._destroyed) return;
      if (Date.now() - this._lastLoad > 5000) {
        this._lastLoad = Date.now();
        this._load();
      }
    }));

    // Fallback poll at 60s
    this._fallbackInterval = setInterval(() => {
      if (!this._destroyed) this._load();
    }, 60000);
  },

  destroy() {
    this._destroyed = true;
    if (this._fallbackInterval) { clearInterval(this._fallbackInterval); this._fallbackInterval = null; }
    if (this._unsubs) { this._unsubs.forEach(fn => fn()); this._unsubs = null; }
  },

  async _load() {
    if (this._loading) return;
    this._loading = true;
    try {
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
      const tokName = o.token_name || '';
      const tokSym = o.token_symbol || '';
      const display = tokSym ? `[${tokSym}]` + (tokName ? ` ${tokName}` : '') : (tokName || '');
      html += `<tr>
        <td>
          <span class="click-token" data-mint="${o.mint}" style="cursor:pointer;color:#00d4aa;display:block;font-size:12px">${display || U.shortAddr(o.mint,8)}</span>
          <span class="click-ca" data-mint="${o.mint}" style="cursor:pointer;color:#666;display:block;font-size:10px" title="Click to copy">${o.mint}</span>
        </td>
        <td>${o.wallet_count}</td><td>${o.trade_count}</td>
        <td>${U.formatShortSOL(o.buy_volume+o.sell_volume)} SOL (~${U.formatUSD((o.buy_volume+o.sell_volume)*p)})</td>
        <td>${o.remaining || 0}</td>
        <td>${U.formatMCAP(o.latest_market_cap, p)}</td>
        <td>${(() => {
          const mcs = (o.entry_mc_values || '').split(',').map(Number).filter(m => m > 0).sort((a, b) => a - b);
          if (!mcs.length) return '—';
          const med = mcs[Math.floor(mcs.length / 2)];
          return `<span title="Median: ${U.formatMCAP(med, p)}">${U.formatMCAP(mcs[0], p)} — ${U.formatMCAP(mcs[mcs.length - 1], p)}</span>`;
        })()}</td>
        <td>${(() => {
          const ts = (o.first_entry_times || '').split(',').map(Number).filter(t => t > 0).sort((a, b) => a - b);
          if (!ts.length) return '—';
          const med = ts[Math.floor(ts.length / 2)];
          return `<span title="Median: ${U.formatShortTime(med)}">${U.formatShortTime(ts[0])} — ${U.formatShortTime(ts[ts.length - 1])}</span>`;
        })()}</td>
        <td>${short}</td><td>${U.formatShortTime(o.last_trade)}</td>
        <td><button class="btn gmgn-btn" data-mint="${o.mint}" style="font-size:10px;padding:3px 8px">GMGN</button></td></tr>`;
    }
    document.querySelector('#to-table tbody').innerHTML = html;
    document.getElementById('to-count').textContent = `${rows.length} tokens`;
    document.getElementById('to-detail').textContent = `Tokens traded by ≥${min} tracked wallets. SOL/USD: $${p.toFixed(2)}`;
    } finally {
    this._loading = false;
    }
  },

  _openGMGN(btn) {
    const mint = btn.dataset.mint;
    if (!mint) return;
    window.api.openExternal(`https://gmgn.ai/sol/token/${mint}`);
  },

  _goToToken(mint) {
    document.querySelector('nav button[data-tab="tokens"]').click();
    setTimeout(() => { if (window.Tokens) window.Tokens._selectToken(mint); }, 200);
  },
};
