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
        <th>Time</th><th>Type</th><th>Wallet</th><th>Token</th><th>Token Amt</th><th>SOL Amt</th><th>Price (SOL)</th><th>Market Cap</th><th>Pool</th><th>GMGN</th>
      </tr></thead><tbody></tbody></table>
    </div>
  `; },

  init() {
    this._destroyed = false;
    this._paused = false;
    this._trades = [];
    this._filters = {};
    this._unsubs = [];
    this._renderScheduled = false;
    if (window._refreshTokenNames) window._refreshTokenNames();
    document.getElementById('lf-pause').onclick = () => {
      this._paused = !this._paused;
      document.getElementById('lf-pause').textContent = this._paused ? 'Resume' : 'Pause';
    };
    document.getElementById('lf-wallet-filter').oninput = (e) => { this._filters.wallet = e.target.value.toLowerCase(); this._render(); };
    document.getElementById('lf-token-filter').oninput  = (e) => { this._filters.token = e.target.value.toLowerCase(); this._render(); };

    document.getElementById('lf-table').addEventListener('click', (e) => {
      const ca = e.target.closest('.click-ca');
      if (ca) { window.api.clipboard.copy(ca.dataset.mint); return; }
      const gmgn = e.target.closest('.click-gmgn');
      if (gmgn) { window.api.openExternal(`https://gmgn.ai/sol/token/${gmgn.dataset.mint}`); return; }
    });
    this._tokenRefreshInterval = setInterval(() => {
      if (window._refreshTokenNames) window._refreshTokenNames();
    }, 30000);

    // Pre-load recent trades so table isn't empty on first view
    window.api.db.getRecentTrades(50).then(r => {
      if (this._destroyed || this._paused || !r.ok || !r.data.length) return;
      this._trades = r.data.map(t => ({
        signature: t.signature, txType: t.tx_type, walletAddress: t.wallet_address,
        mint: t.mint, tokenAmount: t.token_amount ?? 0, solAmount: t.sol_amount ?? 0,
        price: t.price ?? 0, marketCapSol: t.market_cap_sol ?? 0,
        pool: t.pool, poolId: t.pool_id, timestamp: t.timestamp ?? 0,
        block: t.block, priorityFee: t.priority_fee,
      }));
      this._render();
    });

    this._unsubs.push(window.api.events.onTrade((t) => {
      if (this._destroyed || this._paused) return;
      this._trades.unshift(t);
      if (this._trades.length > 500) this._trades = this._trades.slice(0, 500);
      if (!this._renderScheduled) {
        this._renderScheduled = true;
        requestAnimationFrame(() => {
          this._renderScheduled = false;
          if (!this._destroyed) this._render();
        });
      }
      if (document.getElementById('lf-autoscroll')?.checked) {
        document.getElementById('lf-table')?.parentElement?.scrollTo(0, 0);
      }
    }));
  },

  destroy() {
    this._destroyed = true;
    this._trades = [];
    if (this._tokenRefreshInterval) { clearInterval(this._tokenRefreshInterval); this._tokenRefreshInterval = null; }
    if (this._unsubs) { this._unsubs.forEach(fn => fn()); this._unsubs = null; }
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
        <td>${U.walletLabel(t.walletAddress)}</td>
        <td>${U.tokenLabel(t.mint)}</td>
        <td>${U.formatShortSOL(t.tokenAmount)}</td><td>${U.formatShortSOL(t.solAmount)}</td>
        <td>${(t.price||0).toFixed(8)}</td><td>${U.formatMCAP(t.marketCapSol, p)}</td>
        <td>${t.pool||''}</td>
        <td><button class="btn click-gmgn" data-mint="${t.mint}" style="font-size:10px;padding:2px 6px">GMGN</button></td></tr>`;
    }
    tbody.innerHTML = html;
    document.getElementById('lf-count').textContent = `${filtered.length} trades`;
  },
};
