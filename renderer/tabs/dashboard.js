window.Dashboard = {
  html() { return `
    <div class="stats-row" id="dash-stats">
      <div class="stat-card"><div class="stat-value" id="stat-trades">--</div><div class="stat-label">Total Trades</div></div>
      <div class="stat-card"><div class="stat-value" id="stat-wallets">--</div><div class="stat-label">Wallets Tracked</div></div>
      <div class="stat-card"><div class="stat-value" id="stat-tokens">--</div><div class="stat-label">Unique Tokens</div></div>
      <div class="stat-card"><div class="stat-value" id="stat-stream" style="font-size:13px">--</div><div class="stat-label">Stream Status</div></div>
    </div>
    <div class="charts-row">
      <div class="chart-box" id="chart-traders" style="height:220px"></div>
      <div class="chart-box" id="chart-tokens" style="height:220px"></div>
    </div>
    <div class="tables-row">
      <div class="table-box"><div class="table-title">Top Traders (Volume)</div><pre id="text-traders">Loading...</pre></div>
      <div class="table-box"><div class="table-title">Top Tokens (Activity)</div><pre id="text-tokens">Loading...</pre></div>
    </div>
    <div id="dash-last-trade" style="margin-top:8px;font-size:11px;color:#a0a0b0">Last trade: --</div>
  `; },

  init() {
    this._destroyed = false;
    this._lastRefresh = 0;
    this._pendingTimer = null;
    this._refresh();

    this._onTradeHandler = () => {
      if (this._destroyed) return;
      const now = Date.now();
      if (now - this._lastRefresh >= 1000) {
        this._lastRefresh = now;
        this._refresh();
      } else if (!this._pendingTimer) {
        this._pendingTimer = setTimeout(() => {
          this._pendingTimer = null;
          if (!this._destroyed) { this._lastRefresh = Date.now(); this._refresh(); }
        }, 1000 - (now - this._lastRefresh));
      }
    };
    window.api.events.onTrade(this._onTradeHandler);

    this._fallbackInterval = setInterval(() => {
      if (!this._destroyed) this._refresh();
    }, 30000);
  },

  destroy() {
    this._destroyed = true;
    if (this._fallbackInterval) { clearInterval(this._fallbackInterval); this._fallbackInterval = null; }
    if (this._pendingTimer) { clearTimeout(this._pendingTimer); this._pendingTimer = null; }
  },

  async _refresh() {
    const [statsR, tradersR, tokensR] = await Promise.all([
      window.api.db.getDashboardStats(),
      window.api.db.getTopTradersByVolume(10),
      window.api.db.getTopTokensByVolume(10),
    ]);
    const stats = statsR.ok ? statsR.data : null;
    const traders = tradersR.ok ? tradersR.data : [];
    const tokens = tokensR.ok ? tokensR.data : [];

    const U = window.TableUtils;
    if (stats) {
      document.getElementById('stat-trades').textContent = stats.totalTrades;
      document.getElementById('stat-wallets').textContent = stats.totalWallets;
      document.getElementById('stat-tokens').textContent = stats.totalTokens;
    }
    const streamEl = document.getElementById('stat-stream');
    streamEl.className = 'stat-value ' + (window._streamConnected ? 'status-green' : 'status-red');
    streamEl.textContent = window._streamConnected ? `Connected\n${window._streamWalletCount || 0} wallets, ${window._streamTradeCount || 0} trades` : 'Disconnected';

    if (stats?.latestTradeTs && stats.latestTradeTs > 0) {
      document.getElementById('dash-last-trade').textContent = `Last trade: ${U.formatTime(stats.latestTradeTs)} UTC`;
    } else if (stats && stats.totalTrades === 0) {
      document.getElementById('dash-last-trade').textContent = 'Last trade: Waiting for tracked wallet activity...';
    }

    const p = window.solPrice || 0;
    let ttext = 'WALLET                     TRADES  VOLUME (SOL / USD)\n' + '-'.repeat(80) + '\n';
    for (const t of traders) {
      ttext += `${U.shortAddr(t.wallet_address,10).padEnd(27)} ${String(t.trade_count).padStart(7)}  ${U.formatShortSOL(t.total_volume_sol).padStart(12)} SOL  (~${U.formatUSD(t.total_volume_sol * p)})   ${window._walletNames[t.wallet_address]||''}\n`;
    }
    if (!traders.length) ttext += 'No trades yet.\n';
    document.getElementById('text-traders').textContent = ttext;

    let toktext = 'TOKEN                      TRADES  VOLUME (SOL / USD)\n' + '-'.repeat(80) + '\n';
    for (const t of tokens) {
      toktext += `${U.shortAddr(t.mint,10).padEnd(27)} ${String(t.trade_count).padStart(7)}  ${U.formatShortSOL(t.total_volume_sol).padStart(12)} SOL  (~${U.formatUSD(t.total_volume_sol * p)})\n`;
    }
    if (!tokens.length) toktext += 'No trades yet.\n';
    document.getElementById('text-tokens').textContent = toktext;

    window.EChartUtils.barChart(document.getElementById('chart-traders'), 'Top Traders by Volume (SOL)',
      traders.slice(0,8).map(t => U.shortAddr(t.wallet_address,6)), traders.slice(0,8).map(t => t.total_volume_sol));
    window.EChartUtils.barChart(document.getElementById('chart-tokens'), 'Top Tokens by Trade Count',
      tokens.slice(0,8).map(t => U.shortAddr(t.mint,6)), tokens.slice(0,8).map(t => t.trade_count), '#ff7f0e');
  },
};


