// Tab switcher + global IPC listeners
window.solPrice = 0;
window._streamConnected = false;
window._streamWalletCount = 0;
window._streamTradeCount = 0;
window._walletNames = {};
window._refreshWalletNames = async () => {
  const r = await window.api.db.getWallets();
  if (!r.ok) return;
  const map = {};
  for (const w of r.data) {
    if (w.label) map[w.address] = w.label;
  }
  window._walletNames = map;
};

document.getElementById('tab-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

window.switchToTab = (tabId) => {
  const btn = document.querySelector(`nav button[data-tab="${tabId}"]`);
  if (btn) btn.click();
};

let _activeMod = null;

function switchTab(tab) {
  if (_activeMod && _activeMod.destroy) _activeMod.destroy();
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.querySelector(`nav button[data-tab="${tab}"]`)?.classList.add('active');
  const content = document.getElementById('content');
  const modules = {
    dashboard: window.Dashboard, 'live-feed': window.LiveFeed,
    'token-overlap': window.TokenOverlap, wallets: window.Wallets,
    tokens: window.Tokens, analytics: window.Analytics,
    'wallet-manager': window.WalletManager, backfill: window.Backfill,
  };
  const mod = modules[tab];
  if (mod) {
    content.innerHTML = mod.html();
    setTimeout(() => { _activeMod = mod; mod.init(); }, 50);
  }
}

// Global SOL price and stream status
window.api.events.onSolPrice((p) => { window.solPrice = p; });
window.api.price.get().then(r => { if (r.ok && r.data) window.solPrice = r.data; });

window.api.events.onStreamStatus((s) => {
  window._streamConnected = s.startsWith('Connected');
  const nums = s.match(/\d+/g);
  if (nums) {
    window._streamWalletCount = parseInt(nums[0]) || 0;
    window._streamTradeCount = parseInt(nums[1]) || 0;
  }
});

// Initial load
window._refreshWalletNames();
setTimeout(() => switchTab('dashboard'), 100);
