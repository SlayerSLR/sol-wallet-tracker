window.LiveFeed = {
  html() { return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <button class="btn" id="lf-pause">Pause</button>
      <label style="font-size:11px;color:#a0a0b0"><input type="checkbox" id="lf-autoscroll" checked> Auto-scroll</label>
      <input placeholder="Filter wallet..." id="lf-wallet-filter" style="width:200px">
      <input placeholder="Filter token..." id="lf-token-filter" style="width:200px">
      <span id="lf-count" style="margin-left:auto;font-size:12px;color:#a0a0b0">0 trades</span>
    </div>
    <div style="overflow:auto;max-height:calc(100vh - 120px)">
      <table id="lf-table"><thead><tr>
        <th>Time</th><th>Type</th><th>Wallet</th><th>Token</th><th>Token Amt</th><th>SOL Amt</th><th>Price (SOL)</th><th>Market Cap</th><th>Pool</th>
      </tr></thead><tbody></tbody></table>
    </div>
  `; },

  init() {
    this._destroyed = false;
    this._paused = false;
    this._trades = [];
    this._filters = {};
    document.getElementById('lf-pause').onclick = () => {
      this._paused = !this._paused;
      document.getElementById('lf-pause').textContent = this._paused ? 'Resume' : 'Pause';
    };
    document.getElementById('lf-wallet-filter').oninput = (e) => { this._filters.wallet = e.target.value.toLowerCase(); this._render(); };
    document.getElementById('lf-token-filter').oninput  = (e) => { this._filters.token = e.target.value.toLowerCase(); this._render(); };

    window.api.events.onTrade((t) => {
      if (this._destroyed || this._paused) return;
      this._trades.unshift(t);
      if (this._trades.length > 500) this._trades = this._trades.slice(0, 500);
      this._render();
      if (document.getElementById('lf-autoscroll')?.checked) {
        document.getElementById('lf-table')?.parentElement?.scrollTo(0, 0);
      }
    });
  },

  destroy() {
    this._destroyed = true;
    this._trades = [];
  },

  _render() {
    const U = window.TableUtils;
    const wf = this._filters.wallet || '';
    const tf = this._filters.token || '';
    const filtered = this._trades.filter(t => {
      if (wf && !(t.walletAddress||'').toLowerCase().includes(wf)) return false;
      if (tf && !(t.mint||'').toLowerCase().includes(tf)) return false;
      return true;
    });
    const tbody = document.querySelector('#lf-table tbody');
    if (!tbody) return;
    let html = '';
    const p = window.solPrice || 0;
    for (const t of filtered) {
      const cls = t.txType === 'buy' ? 'buy' : 'sell';
      html += `<tr class="${cls}">
        <td>${U.formatTime(t.timestamp)}</td><td>${t.txType}</td>
        <td>${U.walletLabel(t.walletAddress)}</td><td>${U.shortAddr(t.mint,10)}</td>
        <td>${U.formatShortSOL(t.tokenAmount)}</td><td>${U.formatShortSOL(t.solAmount)}</td>
        <td>${(t.price||0).toFixed(8)}</td><td>${U.formatMCAP(t.marketCapSol, p)}</td>
        <td>${t.pool||''}</td></tr>`;
    }
    tbody.innerHTML = html;
    document.getElementById('lf-count').textContent = `${filtered.length} trades`;
  },
};
