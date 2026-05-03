window.Analytics = {
  html() { return `
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <button class="btn" id="a-refresh">Refresh Analytics</button>
      <button class="btn" id="a-recompute">Recompute PnL</button>
      <span id="a-status" style="font-size:12px;color:#a0a0b0"></span>
    </div>
    <div class="charts-row">
      <div class="chart-box" id="a-pnl-dist" style="height:200px"></div>
      <div class="chart-box" id="a-winloss" style="height:200px"></div>
    </div>
    <div style="overflow:auto;max-height:calc(100vh - 340px)">
      <table id="a-table"><thead><tr>
        <th>Wallet</th><th>Trades</th><th>Tokens</th><th>Realized PnL (SOL / USD)</th><th>Win Rate</th><th>Volume (SOL / USD)</th>
      </tr></thead><tbody></tbody></table>
    </div>
  `; },

  init() {
    this.refresh();
    document.getElementById('a-refresh').onclick = () => this.refresh();
    document.getElementById('a-recompute').onclick = () => this._recompute();
  },

  async refresh() {
    document.getElementById('a-status').textContent = 'Loading...';
    const [pnlR, tradersR] = await Promise.all([
      window.api.db.getWalletPnL(),
      window.api.db.getTopTradersByVolume(50),
    ]);
    const pnl = pnlR.ok ? pnlR.data : [];
    const traders = tradersR.ok ? tradersR.data : [];
    document.getElementById('a-status').textContent = '';

    const U = window.TableUtils; const p = window.solPrice || 0;
    const volMap = {}; for (const t of traders) volMap[t.wallet_address] = t;

    // Aggregate PnL by wallet
    const walletMap = {};
    for (const x of pnl) {
      const addr = x.wallet_address;
      if (!walletMap[addr]) {
        walletMap[addr] = { win_count: 0, loss_count: 0, realized_pnl: 0, token_set: new Set() };
      }
      walletMap[addr].win_count += (x.win_count || 0);
      walletMap[addr].loss_count += (x.loss_count || 0);
      walletMap[addr].realized_pnl += (x.realized_pnl || 0);
      walletMap[addr].token_set.add(x.mint);
    }

    const lb = Object.entries(walletMap).map(([addr, d]) => {
      const vi = volMap[addr] || {};
      const totalTrades = d.win_count + d.loss_count;
      return {
        wallet: addr,
        trades: vi.trade_count || 0,
        tokens: d.token_set.size,
        pnl: d.realized_pnl,
        winRate: totalTrades > 0 ? d.win_count / totalTrades : 0,
        volume: vi.total_volume_sol || 0,
      };
    }).sort((a, b) => b.pnl - a.pnl);

    let html = '';
    for (const l of lb) {
      html += `<tr>
        <td>${U.walletLabel(l.wallet)}</td><td>${l.trades}</td><td>${l.tokens}</td>
        <td style="color:${l.pnl>=0?'#00d4aa':'#ff4444'}">${l.pnl>=0?'+':''}${U.formatSOL(l.pnl)} SOL (~${U.formatUSD(l.pnl*p)})</td>
        <td>${(l.winRate*100).toFixed(0)}%</td><td>${U.formatSOL(l.volume)} SOL (~${U.formatUSD(l.volume*p)})</td></tr>`;
    }
    document.querySelector('#a-table tbody').innerHTML = html;

    const values = pnl.map(x => x.realized_pnl||0);
    window.EChartUtils.histogram(document.getElementById('a-pnl-dist'), 'PnL Distribution', values);

    const win = pnl.reduce((s, x) => s + (x.win_count || 0), 0);
    const loss = pnl.reduce((s, x) => s + (x.loss_count || 0), 0);
    window.EChartUtils.barChart(document.getElementById('a-winloss'), 'Win/Loss Distribution',
      ['Win','Loss'], [win,loss], '#00d4aa');
  },

  async _recompute() {
    document.getElementById('a-status').textContent = 'Recomputing PnL...';
    await window.api.db.recomputePnL();
    document.getElementById('a-status').textContent = 'PnL recomputed.';
    this.refresh();
  },

  destroy() {
    ['a-pnl-dist', 'a-winloss'].forEach(id => {
      try { window.EChartUtils.disposeAll(document.getElementById(id)); } catch {}
    });
  },
};

