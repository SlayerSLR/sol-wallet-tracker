window.Backfill = {
  html() { return `
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label style="font-size:12px">Preset:</label>
        <select id="bf-preset" style="width:180px">
          <option value="1">Last 1 hour</option>
          <option value="6" selected>Last 6 hours</option>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="-1">Since April 18, 2026</option>
          <option value="0">Custom range</option>
        </select>
        <label style="font-size:12px">Start:</label>
        <input type="text" id="bf-start" style="width:130px" value="" placeholder="YYYY-MM-DD HH">
        <label style="font-size:12px">End:</label>
        <input type="text" id="bf-end" style="width:130px" value="" placeholder="YYYY-MM-DD HH">
        <button class="btn" id="bf-start-btn">Start Backfill</button>
        <button class="btn" id="bf-pause-btn">Pause</button>
        <button class="btn" id="bf-stop-btn">Stop</button>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid #333">
        <label style="font-size:12px">Cache:</label>
        <input type="text" id="bf-cache-dir" style="width:360px" placeholder="/path/to/cache">
        <button class="btn" id="bf-cache-btn">Process from Cache</button>
        <button class="btn" id="bf-cache-all-btn">Process All Cached</button>
        <span id="bf-cache-stats" style="font-size:11px;color:#a0a0b0"></span>
      </div>
    </div>
    <div class="progress-bar"><div class="fill" id="bf-bar" style="width:0%"></div></div>
    <div id="bf-status" style="font-size:12px;margin:6px 0;color:#a0a0b0">Ready</div>
    <div class="log-box" id="bf-log" style="max-height:160px"></div>
    <div id="bf-stats" style="font-size:11px;margin-top:6px;color:#a0a0b0"></div>
  `; },

  init() {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    document.getElementById('bf-end').value = `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}`;

    document.getElementById('bf-preset').onchange = () => {
      const v = parseInt(document.getElementById('bf-preset').value);
      if (v === -1) {
        document.getElementById('bf-start').value = '2026-04-18 00';
      } else if (v > 0) {
        const end = new Date(); const start = new Date(end.getTime() - v * 3600000);
        document.getElementById('bf-start').value = `${start.getUTCFullYear()}-${pad(start.getUTCMonth()+1)}-${pad(start.getUTCDate())} ${pad(start.getUTCHours())}`;
        document.getElementById('bf-end').value = `${end.getUTCFullYear()}-${pad(end.getUTCMonth()+1)}-${pad(end.getUTCDate())} ${pad(end.getUTCHours())}`;
      }
    };
    document.getElementById('bf-preset').dispatchEvent(new Event('change'));

    // Cache directory
    window.api.cache.getDir().then(r => {
      if (r.ok) document.getElementById('bf-cache-dir').value = r.data;
    });
    document.getElementById('bf-cache-dir').onchange = () => {
      window.api.cache.setDir(document.getElementById('bf-cache-dir').value.trim());
    };

    this._cacheStatsUrl = '';

    this._refreshCacheStats = async () => {
      const scanR = await window.api.cache.scan();
      const s = scanR.ok ? scanR.data : null;
      const el = document.getElementById('bf-cache-stats');
      if (s && s.fileCount) {
        const gb = (s.totalSize / 1e9).toFixed(1);
        el.innerHTML = `${s.fileCount} files | ${s.earliest} &ndash; ${s.latest} | ${gb} GB &nbsp;<a href="#" id="bf-cache-fill">[fill]</a>`;
        el.style.color = '#00d4aa';
        document.getElementById('bf-cache-fill').onclick = (e) => {
          e.preventDefault();
          document.getElementById('bf-start').value = s.earliest;
          document.getElementById('bf-end').value = s.latest;
        };
        document.getElementById('bf-cache-all-btn').disabled = false;
      } else {
        el.textContent = 'No cache files found';
        el.style.color = '#ff4444';
        document.getElementById('bf-cache-all-btn').disabled = true;
      }
    };
    this._refreshCacheStats();

    const getDates = () => {
      const start = document.getElementById('bf-start').value.trim();
      const end = document.getElementById('bf-end').value.trim();
      if (!start || !end) { alert('Enter start and end dates'); return null; }
      return [start + ':00+00:00', end + ':00+00:00'];
    };

    document.getElementById('bf-cache-btn').onclick = () => {
      const d = getDates(); if (!d) return;
      const cacheDir = document.getElementById('bf-cache-dir').value.trim();
      if (!cacheDir) return alert('Set the cache directory first');
      document.getElementById('bf-log').innerHTML = `Processing from cache ${document.getElementById('bf-start').value} to ${document.getElementById('bf-end').value}<br>`;
      document.getElementById('bf-start-btn').disabled = true;
      document.getElementById('bf-cache-btn').disabled = true;
      document.getElementById('bf-cache-all-btn').disabled = true;
      document.getElementById('bf-status').textContent = 'Processing from cache...';
      window.api.backfill.processCache(d[0], d[1]);
    };

    document.getElementById('bf-cache-all-btn').onclick = () => {
      const cacheDir = document.getElementById('bf-cache-dir').value.trim();
      if (!cacheDir) return alert('Set the cache directory first');
      document.getElementById('bf-log').innerHTML = 'Processing all cached files...<br>';
      document.getElementById('bf-start-btn').disabled = true;
      document.getElementById('bf-cache-btn').disabled = true;
      document.getElementById('bf-cache-all-btn').disabled = true;
      document.getElementById('bf-status').textContent = 'Processing all cached files...';
      window.api.backfill.processCacheAll();
    };

    document.getElementById('bf-start-btn').onclick = () => {
      const d = getDates(); if (!d) return;
      document.getElementById('bf-log').innerHTML = `Starting backfill from ${document.getElementById('bf-start').value} to ${document.getElementById('bf-end').value}<br>`;
      document.getElementById('bf-start-btn').disabled = true;
      document.getElementById('bf-cache-btn').disabled = true;
      document.getElementById('bf-cache-all-btn').disabled = true;
      document.getElementById('bf-status').textContent = 'Backfilling...';
      window.api.backfill.start(d[0], d[1]);
    };
    document.getElementById('bf-pause-btn').onclick = () => {
      const btn = document.getElementById('bf-pause-btn');
      const isPaused = btn.textContent === 'Resume';
      if (isPaused) window.api.backfill.resume();
      else window.api.backfill.pause();
      btn.textContent = isPaused ? 'Pause' : 'Resume';
    };
    document.getElementById('bf-stop-btn').onclick = () => {
      window.api.backfill.stop();
      document.getElementById('bf-start-btn').disabled = false;
      document.getElementById('bf-cache-btn').disabled = false;
      document.getElementById('bf-cache-all-btn').disabled = false;
      document.getElementById('bf-status').textContent = 'Stopped';
      document.getElementById('bf-bar').style.width = '0%';
    };

    window.api.events.onBackfillProgress((d) => {
      document.getElementById('bf-bar').style.width = d.percent + '%';
      const skipped = d.skipped ? ' (skipped)' : '';
      document.getElementById('bf-log').innerHTML += `[${d.currentHour}]${skipped} ${d.matched} matches / ${d.totalEvents} events (${d.completed}/${d.total})<br>`;
      document.getElementById('bf-stats').textContent = `Progress: ${d.completed}/${d.total} hours (${d.percent}%)`;
      const el = document.getElementById('bf-log');
      el.scrollTop = el.scrollHeight;
    });
    window.api.events.onBackfillStatus((msg) => {
      document.getElementById('bf-status').textContent = msg;
      if (msg.toLowerCase().includes('complete')) {
        document.getElementById('bf-start-btn').disabled = false;
        document.getElementById('bf-cache-btn').disabled = false;
        document.getElementById('bf-cache-all-btn').disabled = false;
        document.getElementById('bf-bar').style.width = '100%';
      }
    });
  },
};
