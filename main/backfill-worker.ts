import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawn, ChildProcess } from 'node:child_process';
import {
  getWalletSet, insertTrade, isBackfillComplete, setBackfillProgress,
} from './database.js';
import type { Trade } from './database.js';

const REPLAY_BASE = 'https://replay.pumpapi.io';
const KNOWN_POOLS = ['pump', 'pump-amm', 'raydium-launchpad', 'raydium-cpmm', 'meteora-launchpad', 'meteora-damm-v1', 'meteora-damm-v2'];

function safePoolBf(val: string | null | undefined): string | null {
  if (!val) return null;
  return KNOWN_POOLS.includes(val) ? val : null;
}

function parseFloatSafe(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface BackfillProgressData {
  completed: number; total: number; currentHour: string;
  totalEvents: number; matched: number; skipped: boolean; percent: number;
}

export interface CacheScanResult {
  earliest: string; latest: string; fileCount: number; totalSize: number;
}

type CacheFile = { name: string; hourKey: string; date: Date };

const DEFAULT_CACHE_DIR = '/media/amalj/Elements/historical-data/data';

// Resolved relative to dist/main/backfill-worker.js → rust/pump-tool/target/release/pump-tool
const PUMP_TOOL_PATH = path.join(__dirname, '..', '..', 'rust', 'pump-tool', 'target', 'release', 'pump-tool');

export class BackfillWorker {
  private _running = false;
  private _paused = false;
  private _rustProc: ChildProcess | null = null;
  private _progressCb: ((d: BackfillProgressData) => void) | null = null;
  private _statusCb: ((msg: string) => void) | null = null;
  private _cacheDir = DEFAULT_CACHE_DIR;

  onProgress(cb: (d: BackfillProgressData) => void) { this._progressCb = cb; }
  onStatus(cb: (msg: string) => void) { this._statusCb = cb; }
  pause() { this._paused = true; }
  resume() { this._paused = false; }
  async stop() {
    this._running = false;
    this._paused = false;
    if (this._rustProc) {
      this._rustProc.kill();
      this._rustProc = null;
    }
  }

  setCacheDir(dir: string) { this._cacheDir = dir; }
  getCacheDir(): string { return this._cacheDir; }

  scanCache(): CacheScanResult {
    if (!fs.existsSync(this._cacheDir)) {
      return { earliest: '', latest: '', fileCount: 0, totalSize: 0 };
    }
    const entries = listCacheFiles(this._cacheDir);
    return {
      earliest: entries.length > 0 ? formatCacheDate(entries[0].date) : '',
      latest: entries.length > 0 ? formatCacheDate(entries[entries.length - 1].date) : '',
      fileCount: entries.length,
      totalSize: entries.reduce((s, f) => s + fs.statSync(path.join(this._cacheDir, f.name)).size, 0),
    };
  }

  async start(startDate: string, endDate: string) {
    if (this._running) return;
    this._running = true;
    this._paused = false;
    this._runBackfill(startDate, endDate);
  }

  async processFromCache(startDate: string, endDate: string) {
    if (this._running) return;
    if (!fs.existsSync(this._cacheDir)) {
      this._notifyStatus(`Cache directory not found: ${this._cacheDir}`);
      return;
    }
    this._running = true;
    this._paused = false;
    this._runFromCache(startDate, endDate);
  }

  async processAllFromCache() {
    if (this._running) return;
    if (!fs.existsSync(this._cacheDir)) {
      this._notifyStatus(`Cache directory not found: ${this._cacheDir}`);
      return;
    }
    const entries = listCacheFiles(this._cacheDir);
    if (!entries.length) {
      this._notifyStatus('No cache files found.');
      return;
    }
    this._running = true;
    this._paused = false;
    // Pass empty strings for start/end — Rust processes all files when no date range given
    this._runFromCache('', '');
  }

  private _notifyStatus(msg: string) { if (this._statusCb) this._statusCb(msg); }
  private _notifyProgress(d: BackfillProgressData) { if (this._progressCb) this._progressCb(d); }

  private _runBackfill(startDate: string, endDate: string) {
    const walletSet = getWalletSet();
    if (walletSet.size === 0) {
      this._notifyStatus('No wallets tracked. Add wallets before backfilling.');
      this._running = false;
      return;
    }
    const hourKeys = generateHourKeys(startDate, endDate);
    const totalHours = hourKeys.length;
    let completedHours = 0;
    let totalMatchedAll = 0;
    const self = this;
    const cacheDir = self._cacheDir;

    const processNext = (idx: number) => {
      if (!self._running || idx >= hourKeys.length) {
        self._notifyStatus(`Backfill complete. ${totalMatchedAll} trades matched.`);
        self._running = false;
        return;
      }
      if (self._paused) { setTimeout(() => processNext(idx), 500); return; }

      const hourKey = hourKeys[idx];
      if (isBackfillComplete(hourKey)) {
        completedHours++;
        self._notifyProgress({ completed: completedHours, total: totalHours, currentHour: hourKey, totalEvents: 0, matched: 0, skipped: true, percent: Math.round(completedHours / totalHours * 100) });
        setImmediate(() => processNext(idx + 1));
        return;
      }

      const localFile = hourKeyToLocalPath(cacheDir, hourKey);
      const promise = fs.existsSync(localFile)
        ? (self._notifyStatus(`Processing ${hourKey} from cache...`), processStream(fs.createReadStream(localFile), hourKey, walletSet))
        : (self._notifyStatus(`Downloading ${hourKey}...`), downloadFromHttp(`${REPLAY_BASE}/${hourKey}.jsonl.zst`, hourKey, walletSet));

      promise
        .then(({ events: eventsTotal, matched: eventsMatched }) => {
          setBackfillProgress(hourKey, 'complete', eventsTotal, eventsMatched);
          totalMatchedAll += eventsMatched;
          completedHours++;
          self._notifyProgress({ completed: completedHours, total: totalHours, currentHour: hourKey, totalEvents: eventsTotal, matched: eventsMatched, skipped: false, percent: Math.round(completedHours / totalHours * 100) });
          setImmediate(() => processNext(idx + 1));
        })
        .catch((err) => {
          console.warn(`Backfill failed for ${hourKey}: ${err.message}`);
          setBackfillProgress(hourKey, 'failed', 0, 0);
          completedHours++;
          self._notifyProgress({ completed: completedHours, total: totalHours, currentHour: hourKey, totalEvents: 0, matched: 0, skipped: false, percent: Math.round(completedHours / totalHours * 100) });
          setImmediate(() => processNext(idx + 1));
        });
    };

    setImmediate(() => processNext(0));
  }

  private _runFromCache(startDate: string, endDate: string) {
    const walletSet = getWalletSet();
    if (walletSet.size === 0) {
      this._notifyStatus('No wallets tracked.');
      this._running = false;
      return;
    }

    if (!fs.existsSync(PUMP_TOOL_PATH)) {
      this._notifyStatus(`pump-tool binary not found at ${PUMP_TOOL_PATH}. Run "npm run build:rust" first.`);
      this._running = false;
      return;
    }

    const walletsPath = path.join(os.tmpdir(), `pump-wallets-${process.pid}.txt`);
    fs.writeFileSync(walletsPath, [...walletSet].join('\n'));

    const args: string[] = [
      'process',
      '--cache-dir', this._cacheDir,
      '--wallets-file', walletsPath,
    ];
    if (startDate) args.push('--start', startDate);
    if (endDate) args.push('--end', endDate);

    this._notifyStatus('Starting Rust pump-tool...');

    const rust = spawn(PUMP_TOOL_PATH, args);
    this._rustProc = rust;
    const self = this;

    let totalFiles = 0;
    let currentHour = '';
    let completedHours = 0;
    let totalMatchedAll = 0;
    const batch: Trade[] = [];

    // stdout: matched trade JSON lines → parseLine → batch INSERT
    let stdoutBuf = '';
    rust.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const trades = parseLine(line, walletSet);
        for (const t of trades) { batch.push(t); }
        if (batch.length >= 500) { flushBatch(batch); batch.length = 0; }
      }
    });

    // stderr: progress JSONL events
    let stderrBuf = '';
    rust.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          switch (evt.type) {
            case 'wallet_count':
              break;
            case 'files_found':
              totalFiles = evt.count;
              break;
            case 'file_start':
              currentHour = evt.hour_key;
              self._notifyStatus(`Processing ${currentHour} (${evt.current_file}/${evt.total_files})...`);
              break;
            case 'progress':
              self._notifyProgress({
                completed: completedHours,
                total: totalFiles,
                currentHour: evt.hour_key,
                totalEvents: evt.processed,
                matched: evt.matched,
                skipped: false,
                percent: totalFiles > 0 ? Math.round(completedHours / totalFiles * 100) : 0,
              });
              break;
            case 'file_done':
              setBackfillProgress(evt.hour_key, 'complete', evt.processed, evt.matched);
              totalMatchedAll += evt.matched;
              completedHours = evt.current_file;
              self._notifyProgress({
                completed: completedHours,
                total: totalFiles,
                currentHour: evt.hour_key,
                totalEvents: evt.processed,
                matched: evt.matched,
                skipped: false,
                percent: totalFiles > 0 ? Math.round(completedHours / totalFiles * 100) : 0,
              });
              break;
            case 'done':
              break;
          }
        } catch { /* ignore malformed stderr lines */ }
      }
    });

    rust.on('error', (err: Error) => {
      console.warn(`pump-tool spawn error: ${err.message}`);
      self._notifyStatus(`pump-tool error: ${err.message}`);
      fs.unlinkSync(walletsPath);
      self._running = false;
      self._rustProc = null;
    });

    rust.on('close', (code: number | null) => {
      // Flush remaining stdout
      if (stdoutBuf.trim()) {
        const trades = parseLine(stdoutBuf, walletSet);
        for (const t of trades) batch.push(t);
      }
      if (batch.length) flushBatch(batch);

      try { fs.unlinkSync(walletsPath); } catch {}

      if (code !== 0 && self._running) {
        self._notifyStatus(`pump-tool exited with code ${code}`);
      } else if (self._running) {
        self._notifyStatus(`Cache processing complete. ${totalMatchedAll} trades matched (${totalFiles} files).`);
      }
      self._running = false;
      self._rustProc = null;
    });
  }
}

function generateHourKeys(startDate: string, endDate: string): string[] {
  const keys: string[] = [];
  const current = new Date(startDate);
  current.setMinutes(0, 0, 0);
  const end = new Date(endDate);
  while (current < end) {
    const pad = (n: number) => String(n).padStart(2, '0');
    keys.push(`${current.getUTCFullYear()}/${pad(current.getUTCMonth() + 1)}/${pad(current.getUTCDate())}/${pad(current.getUTCHours())}`);
    current.setHours(current.getHours() + 1);
  }
  return keys;
}

function hourKeyToLocalPath(cacheDir: string, hourKey: string): string {
  const filename = hourKey.replace(/\//g, '-') + '.jsonl.zst';
  return path.join(cacheDir, filename);
}

function parseCacheFilename(filename: string): { hourKey: string; date: Date } | null {
  const m = filename.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})\.jsonl\.zst$/);
  if (!m) return null;
  const [, y, mo, d, h] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:00:00Z`);
  return { hourKey: `${y}/${mo}/${d}/${h}`, date };
}

function formatCacheDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:00`;
}

function listCacheFiles(cacheDir: string): CacheFile[] {
  const entries: CacheFile[] = [];
  for (const name of fs.readdirSync(cacheDir)) {
    const p = parseCacheFilename(name);
    if (p) entries.push({ name, ...p });
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  return entries;
}

function processStream(
  stream: Readable, hourKey: string, walletSet: Set<string>
): Promise<{ events: number; matched: number }> {
  return new Promise((resolve, reject) => {
    const zstd: ChildProcess = spawn('zstd', ['-d', '--stdout', '--no-progress']);
    if (!zstd.stdin || !zstd.stdout) { reject(new Error('zstd has no stdin/stdout')); return; }
    let stderrBuf = '';
    zstd.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString(); });
    stream.pipe(zstd.stdin);
    let buffer = '';
    let eventsTotal = 0;
    let eventsMatched = 0;
    const batch: Trade[] = [];

    zstd.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        eventsTotal++;
        const trades = parseLine(line, walletSet);
        for (const t of trades) { batch.push(t); eventsMatched++; }
        if (batch.length >= 500) { flushBatch(batch); batch.length = 0; }
      }
    });

    zstd.stdout.on('end', () => {
      if (buffer.trim()) {
        eventsTotal++;
        const trades = parseLine(buffer, walletSet);
        for (const t of trades) { batch.push(t); eventsMatched++; }
      }
      if (batch.length) flushBatch(batch);
      if (stderrBuf.trim()) console.warn(`zstd stderr for ${hourKey}: ${stderrBuf.trim()}`);
      resolve({ events: eventsTotal, matched: eventsMatched });
    });

    zstd.on('error', (e) => {
      if (stderrBuf.trim()) console.warn(`zstd stderr before error for ${hourKey}: ${stderrBuf.trim()}`);
      reject(e);
    });
    stream.on('error', (e) => reject(e));
  });
}

function downloadFromHttp(
  url: string, hourKey: string, walletSet: Set<string>
): Promise<{ events: number; matched: number }> {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode === 404) { res.resume(); resolve({ events: 0, matched: 0 }); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      processStream(res, hourKey, walletSet).then(resolve).catch(reject);
    }).on('error', (e) => reject(e));
  });
}

function parseLine(line: string, walletSet: Set<string>): Trade[] {
  let data: any;
  try { data = JSON.parse(line); } catch { return []; }
  const txType = data.txType;
  if (txType !== 'buy' && txType !== 'sell') return [];
  const traders: Record<string, unknown> = data.tradersInvolved || {};
  const traderKeys = Object.keys(traders);
  if (!traderKeys.length) return [];
  const matches = traderKeys.filter(k => walletSet.has(k));
  if (!matches.length) return [];

  const solAmount = data.solAmount != null ? parseFloatSafe(data.solAmount) : parseFloatSafe(data.quoteAmount);
  return matches.map(walletAddr => ({
    signature: data.signature || '', tx_type: txType, wallet_address: walletAddr, mint: data.mint || '',
    token_amount: parseFloatSafe(data.tokenAmount), sol_amount: solAmount,
    price: parseFloatSafe(data.price),
    market_cap_sol: data.marketCapSol != null ? parseFloatSafe(data.marketCapSol) : parseFloatSafe(data.marketCapQuote),
    pool: safePoolBf(data.pool), pool_id: data.poolId || null, tx_signers: data.txSigner || '',
    quote_mint: data.quoteMint || null, quote_amount: data.quoteAmount != null ? parseFloatSafe(data.quoteAmount) : null,
    timestamp: parseInt(data.timestamp || '0', 10) || 0,
    block: parseInt(data.block || '0', 10) || 0,
    priority_fee: parseFloatSafe(data.priorityFee) || null,
  }));
}

function flushBatch(batch: Trade[]) { for (const t of batch) insertTrade(t); }

export { generateHourKeys };
