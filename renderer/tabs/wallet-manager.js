window.WalletManager = {
  html() { return `
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <button class="btn" id="wm-import-json">Import JSON</button>
      <button class="btn" id="wm-import-csv">Import CSV</button>
      <button class="btn" id="wm-paste">Paste Addresses</button>
      <button class="btn" id="wm-add">Add Single</button>
      <button class="btn" id="wm-remove">Remove Selected</button>
      <button class="btn" id="wm-refresh">Refresh</button>
      <span id="wm-count" style="margin-left:auto;font-size:12px;color:#a0a0b0">0 wallets</span>
      <span id="wm-status" style="font-size:12px;color:#00d4aa"></span>
    </div>
    <div id="wm-progress-bar" style="display:none;margin-bottom:8px">
      <div class="progress-bar"><div class="fill" id="wm-import-fill" style="width:0%"></div></div>
      <div id="wm-import-status" style="font-size:11px;color:#a0a0b0;margin-top:4px"></div>
    </div>
    <div id="wm-paste-area" style="display:none;margin-bottom:8px">
      <textarea id="wm-paste-input" placeholder="Paste wallet addresses (one per line, comma-separated, or JSON array)..." rows="6" style="width:100%"></textarea>
      <div style="margin-top:4px;display:flex;gap:6px">
        <button class="btn" id="wm-paste-confirm">Import</button>
        <button class="btn" id="wm-paste-cancel">Cancel</button>
      </div>
    </div>
    <div id="wm-add-area" style="display:none;margin-bottom:8px;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="wm-add-addr" placeholder="Wallet address" style="flex:1;min-width:300px">
      <input id="wm-add-label" placeholder="Label (optional)" style="flex:1;min-width:120px">
      <input id="wm-add-tags" placeholder="Tags (optional, comma-sep)" style="flex:1;min-width:120px">
      <button class="btn" id="wm-add-confirm">Save</button>
      <button class="btn" id="wm-add-cancel">Cancel</button>
    </div>
    <div id="wm-confirm-dialog" style="display:none;background:var(--card);border:1px solid var(--accent);border-radius:6px;padding:12px;margin-bottom:8px;text-align:center">
      <p id="wm-confirm-msg" style="margin-bottom:8px;font-size:13px"></p>
      <button class="btn" id="wm-confirm-yes">Yes, Remove</button>
      <button class="btn" id="wm-confirm-no">Cancel</button>
    </div>
    <div style="overflow:auto;max-height:calc(100vh - 120px)">
      <table id="wm-table"><thead><tr>
        <th>☐</th><th>Address</th><th>Label</th><th>Tags</th><th>Added At</th>
      </tr></thead><tbody></tbody></table>
    </div>
    <input type="file" id="wm-file-input" style="display:none" accept=".json,.csv">
  `; },

  init() {
    this._busy = false;
    this._load();
    document.getElementById('wm-refresh').onclick = () => this._load();
    document.getElementById('wm-import-json').onclick = () => { const f=document.getElementById('wm-file-input'); f.accept='.json'; f.onchange=e=>this._handleFile(e,'json'); f.click(); };
    document.getElementById('wm-import-csv').onclick = () => { const f=document.getElementById('wm-file-input'); f.accept='.csv'; f.onchange=e=>this._handleFile(e,'csv'); f.click(); };

    document.getElementById('wm-paste').onclick = () => this._showPaste();
    document.getElementById('wm-paste-cancel').onclick = () => this._hidePaste();
    document.getElementById('wm-paste-confirm').onclick = () => { const t=document.getElementById('wm-paste-input').value.trim(); if(t){this._parsePaste(t);this._hidePaste();} };

    document.getElementById('wm-add').onclick = () => this._showAdd();
    document.getElementById('wm-add-cancel').onclick = () => this._hideAdd();
    document.getElementById('wm-add-confirm').onclick = () => {
      const addr = document.getElementById('wm-add-addr').value.trim();
      if (!addr) { this._setStatus('Enter a wallet address'); return; }
      const label = document.getElementById('wm-add-label').value.trim();
      const tags = document.getElementById('wm-add-tags').value.trim();
      this._add(addr, label, tags);
      this._hideAdd();
    };

    document.getElementById('wm-remove').onclick = () => this._removeSelected();
    document.getElementById('wm-confirm-yes').onclick = () => { this._confirmRemove(); document.getElementById('wm-confirm-dialog').style.display = 'none'; };
    document.getElementById('wm-confirm-no').onclick = () => { this._pendingRemoval = null; document.getElementById('wm-confirm-dialog').style.display = 'none'; };

    this._unsubs = [];
    this._unsubs.push(window.api.events.onWalletImportProgress((d) => {
      document.getElementById('wm-import-fill').style.width = Math.round(d.done / d.total * 100) + '%';
      document.getElementById('wm-import-status').textContent = `${d.done} / ${d.total} processed, ${d.inserted} inserted`;
    }));

    const focusOutHandler = (e) => {
      const cell = e.target;
      if (!cell.hasAttribute('contenteditable') || !cell.dataset.addr) return;
      const row = cell.closest('tr');
      if (!row) return;
      const addr = cell.dataset.addr;
      const label = (row.querySelector('[data-field="label"]')?.textContent || '').trim();
      const tags = (row.querySelector('[data-field="tags"]')?.textContent || '').trim();
      window.api.db.updateWallet(addr, label, tags);
      if (window._refreshWalletNames) window._refreshWalletNames();
    };
    document.getElementById('wm-table').addEventListener('focusout', focusOutHandler);
    this._unsubs.push(() => document.getElementById('wm-table').removeEventListener('focusout', focusOutHandler));
  },

  _setStatus(msg) { document.getElementById('wm-status').textContent = msg; },
  _setButtonsDisabled(disabled) {
    ['wm-import-json','wm-import-csv','wm-paste','wm-add','wm-remove','wm-refresh',
     'wm-paste-confirm','wm-add-confirm','wm-confirm-yes','wm-confirm-no']
      .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = disabled; });
  },
  _showProgress() { document.getElementById('wm-progress-bar').style.display = 'block'; },
  _hideProgress() { document.getElementById('wm-progress-bar').style.display = 'none'; },

  _showPaste() {
    document.getElementById('wm-paste-area').style.display = 'block';
    document.getElementById('wm-paste-input').value = '';
    document.getElementById('wm-paste-input').focus();
  },
  _hidePaste() { document.getElementById('wm-paste-area').style.display = 'none'; },

  _showAdd() {
    document.getElementById('wm-add-area').style.display = 'flex';
    document.getElementById('wm-add-addr').value = '';
    document.getElementById('wm-add-label').value = '';
    document.getElementById('wm-add-tags').value = '';
    document.getElementById('wm-add-addr').focus();
  },
  _hideAdd() { document.getElementById('wm-add-area').style.display = 'none'; },

  async _load() {
    const r = await window.api.db.getWallets();
    const wallets = r.ok ? r.data : [];
    if (window._refreshWalletNames) window._refreshWalletNames();
    document.getElementById('wm-count').textContent = `${wallets.length} wallets`;
    document.querySelector('#wm-table tbody').innerHTML = wallets.map(w =>
      `<tr>
        <td><input type="checkbox" value="${w.address}" class="wm-check"></td>
        <td>${w.address}</td>
        <td contenteditable="true" data-addr="${w.address}" data-field="label">${w.label||''}</td>
        <td contenteditable="true" data-addr="${w.address}" data-field="tags">${w.tags||''}</td>
        <td>${w.added_at||''}</td>
      </tr>`
    ).join('');
  },

  async _add(addr, label='', tags='') {
    const r = await window.api.db.addWallet(addr, label, tags);
    if (r.ok && r.data) {
      this._setStatus('Wallet added.');
    } else {
      this._setStatus('Already tracked.');
    }
    await window.api.stream.refresh();
    this._load();
  },

  async _removeSelected() {
    const checks = document.querySelectorAll('.wm-check:checked');
    const addrs = [...checks].map(c => c.value);
    if (!addrs.length) { this._setStatus('Select wallets to remove'); return; }
    this._pendingRemoval = addrs;
    document.getElementById('wm-confirm-msg').textContent = `Remove ${addrs.length} wallet(s)?`;
    document.getElementById('wm-confirm-dialog').style.display = 'block';
  },

  async _confirmRemove() {
    const addrs = this._pendingRemoval;
    if (!addrs || !addrs.length) return;
    for (const addr of addrs) {
      await window.api.db.removeWallet(addr);
    }
    await window.api.stream.refresh();
    this._load();
    this._setStatus(`Removed ${addrs.length} wallets.`);
    this._pendingRemoval = null;
  },

  async _importItems(items) {
    if (!items.length) return;
    if (this._busy) return;
    this._busy = true;
    this._setButtonsDisabled(true);
    this._showProgress();
    this._setStatus(`Importing ${items.length} wallets...`);

    try {
      const r = await window.api.db.importWalletsChunked(items);
      if (r.ok) {
        const inserted = r.data;
        const already = items.length - inserted;
        console.log('Chunked import complete:', inserted, 'inserted,', already, 'already tracked');
        this._setStatus(`Imported ${inserted} wallets${already > 0 ? ` (${already} already tracked)` : ''}`);
      } else {
        console.error('Chunked import returned error:', r.error);
        this._setStatus(`Import failed: ${r.error || 'unknown error'}`);
      }
    } catch (e) {
      console.error('Chunked import threw:', e);
      this._setStatus('Import failed');
    }

    this._hideProgress();
    this._setButtonsDisabled(false);
    this._busy = false;
    await window.api.stream.refresh();
    this._load();
  },

  _handleFile(e, type) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      if (type === 'json') {
        try {
          const data = JSON.parse(text);
          const items = [];
          if (Array.isArray(data)) {
            for (const o of data) {
              if (o.trackedWalletAddress) items.push([o.trackedWalletAddress, o.name||'', (o.groups||[]).join(',')]);
              else if (o.address) items.push([o.address, o.name||o.label||'', (o.tags||o.groups||[]).join(',')]);
            }
          }
          if (items.length) { console.log('Import items parsed:', items.length, 'wallets'); this._importItems(items); }
          else console.log('Import: no wallet entries found in file');
        } catch (e) {
          console.error('Wallet JSON file parse error:', e);
          this._setStatus('Failed to parse JSON file. Check the format.');
        }
      } else {
        const lines = text.split('\n').filter(l => l.trim());
        const items = [];
        const start = lines[0] && /address|wallet/i.test(lines[0]) ? 1 : 0;
        for (let i = start; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts[0]?.trim()) items.push([parts[0].trim(), parts[1]?.trim()||'', parts[2]?.trim()||'']);
        }
        if (items.length) this._importItems(items);
      }
    };
    reader.readAsText(file);
  },

  _parsePaste(text) {
    try {
      const data = JSON.parse(text);
      const items = [];
      if (Array.isArray(data)) {
        for (const o of data) {
          if (o.trackedWalletAddress) items.push([o.trackedWalletAddress, o.name||'', (o.groups||[]).join(',')]);
        }
      }
      if (items.length) { console.log('Paste import parsed:', items.length, 'wallets'); return this._importItems(items); }
    } catch (e) {
      console.error('Wallet paste JSON parse error:', e);
    }
    const lines = text.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
    if (lines.length) this._importItems(lines.map(l => [l]));
  },

  destroy() {
    if (this._unsubs) { this._unsubs.forEach(fn => fn()); this._unsubs = null; }
  },
};
