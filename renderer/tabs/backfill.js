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
    </div>
    <div class="progress-bar"><div class="fill" id="bf-bar" style="width:0%"></div></div>
    <div id="bf-status" style="font-size:12px;margin:6px 0;color:#a0a0b0">Ready</div>
    <div class="log-box" id="bf-log" style="max-height:160px"></div>
    <div id="bf-stats" style="font-size:11px;margin-top:6px;color:#a0a0b0"></div>
  `; },

  init() {
    // Set default end date to now
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

    document.getElementById('bf-start-btn').onclick = () => {
      const start = document.getElementById('bf-start').value.trim();
      const end = document.getElementById('bf-end').value.trim();
      if (!start || !end) return alert('Enter start and end dates');
      document.getElementById('bf-log').innerHTML = `Starting backfill from ${start} to ${end}<br>`;
      document.getElementById('bf-start-btn').disabled = true;
      document.getElementById('bf-status').textContent = 'Backfilling...';
      window.api.backfill.start(start + ':00+00:00', end + ':00+00:00');
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
        document.getElementById('bf-bar').style.width = '100%';
      }
    });
  },
};
