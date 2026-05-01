// Shared table building helpers
window.TableUtils = {
  formatSOL(n) {
    if (n == null || n === 0) return '0.0000';
    return Number(n).toFixed(4);
  },
  formatShortSOL(n) {
    if (n == null || n === 0) return '0.00';
    return Number(n).toFixed(2);
  },
  formatUSD(n) {
    if (n == null || n === 0) return '$0';
    const v = Math.abs(n);
    if (v >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  },
  formatMCAP(sol, price) {
    const usd = (sol || 0) * (price || 0);
    return `${this.formatShortSOL(sol)} SOL (~${this.formatUSD(usd)})`;
  },
  formatTime(ts) {
    if (!ts || ts === 0) return '';
    return new Date(Number(ts)).toISOString().replace('T', ' ').slice(0, 19);
  },
  formatShortTime(ts) {
    if (!ts || ts === 0) return '';
    return new Date(Number(ts)).toISOString().replace('T', ' ').slice(5, 16);
  },
  walletLabel(addr) {
    if (!addr) return '';
    const name = (window._walletNames && window._walletNames[addr]) || '';
    const trunc = this.shortAddr(addr, 6);
    if (name) return `<span title="${addr}">${this._esc(name)}</span>`;
    return `<span title="${addr}">${trunc}</span>`;
  },
  _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  shortAddr(addr, len = 8) {
    if (!addr) return '';
    if (addr.length <= len * 2 + 4) return addr;
    return addr.slice(0, len) + '...' + addr.slice(-len);
  },
  buildTable(containerId, headers, rows, rowClassFn) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let html = '<thead><tr>';
    for (const h of headers) html += `<th>${h}</th>`;
    html += '</tr></thead><tbody>';
    for (let i = 0; i < rows.length; i++) {
      const cls = rowClassFn ? rowClassFn(rows[i], i) : '';
      html += `<tr class="${cls}">`;
      for (const cell of rows[i]) html += `<td>${cell}</td>`;
      html += '</tr>';
    }
    html += '</tbody>';
    container.innerHTML = html;
  },
};
