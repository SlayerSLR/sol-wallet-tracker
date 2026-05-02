import Database from 'better-sqlite3';

let db: Database.Database | null = null;

// === In-memory dashboard cache ===
let _totalTrades = 0;
let _totalWallets = 0;
let _totalTokens = 0;
let _latestTradeTs = 0;
const _knownMints = new Set<string>();
let _incTraderStmt: Database.Statement | null = null;
let _incTokenStmt: Database.Statement | null = null;

function _getIncTraderStmt(): Database.Statement {
  if (!_incTraderStmt) {
    _incTraderStmt = getDb().prepare(`INSERT INTO trader_vol_cache (wallet_address, trade_count, total_volume_sol) VALUES (?, 1, ?) ON CONFLICT(wallet_address) DO UPDATE SET trade_count = trader_vol_cache.trade_count + 1, total_volume_sol = trader_vol_cache.total_volume_sol + excluded.total_volume_sol`);
  }
  return _incTraderStmt;
}

function _getIncTokenStmt(): Database.Statement {
  if (!_incTokenStmt) {
    _incTokenStmt = getDb().prepare(`INSERT INTO token_vol_cache (mint, trade_count, total_volume_sol, sum_market_cap_sol) VALUES (?, 1, ?, ?) ON CONFLICT(mint) DO UPDATE SET trade_count = token_vol_cache.trade_count + 1, total_volume_sol = token_vol_cache.total_volume_sol + excluded.total_volume_sol, sum_market_cap_sol = token_vol_cache.sum_market_cap_sol + excluded.sum_market_cap_sol`);
  }
  return _incTokenStmt;
}

// ====== Types ======
export interface Wallet { address: string; label: string; tags: string; added_at: string; }
export interface Trade {
  signature: string; tx_type: string; wallet_address: string; mint: string;
  token_amount: number; sol_amount: number; price: number; market_cap_sol: number;
  pool: string | null; pool_id: string | null; tx_signers: string;
  quote_mint: string | null; quote_amount: number | null;
  timestamp: number; block: number; priority_fee: number | null;
}
export interface DashboardStats { totalTrades: number; totalWallets: number; totalTokens: number; latestTradeTs: number; }
export interface TraderVolume { wallet_address: string; trade_count: number; total_volume_sol: number; }
export interface TokenVolume { mint: string; trade_count: number; total_volume_sol: number; avg_market_cap: number; }
export interface OverlapRow { mint: string; wallet_count: number; trade_count: number; buy_volume: number; sell_volume: number; latest_market_cap: number; last_trade: number; trader_list: string; remaining: number; token_name: string | null; token_symbol: string | null; }
export interface WalletStats { total_trades: number; buys: number; sells: number; total_buy_volume: number; total_sell_volume: number; unique_tokens: number; avg_buy_price: number | null; avg_sell_price: number | null; last_trade: number | null; first_trade: number | null; }
export interface TokenStats { total_trades: number; unique_wallets: number; buy_volume: number; sell_volume: number; avg_market_cap: number | null; peak_market_cap: number | null; last_trade: number | null; first_trade: number | null; }
export interface PnLRow { wallet_address: string; mint: string; total_bought: number; total_sold: number; avg_buy_price: number; avg_sell_price: number; realized_pnl: number; unrealized_pnl: number; current_balance: number; last_trade_at: number; last_updated: number; win_count: number; loss_count: number; }
export interface BackfillProgress { hour_key: string; status: string; events_total: number; events_matched: number; started_at: string | null; completed_at: string | null; }

// ====== Init ======
export function initDatabase(dbPath: string): void {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('foreign_keys = ON');
  createTables();
  migrateTradesTable();
  migrateWalletPnlTable();
  hydrateCaches();
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function hydrateCaches(): void {
  const d = getDb();
  _totalTrades = (d.prepare('SELECT COUNT(*) as cnt FROM trades').get() as { cnt: number }).cnt;
  _totalWallets = (d.prepare('SELECT COUNT(*) as cnt FROM wallets').get() as { cnt: number }).cnt;
  _latestTradeTs = (d.prepare('SELECT MAX(timestamp) as ts FROM trades').get() as { ts: number } | undefined)?.ts ?? 0;

  _knownMints.clear();
  const mints = d.prepare('SELECT DISTINCT mint FROM trades').all() as { mint: string }[];
  for (const m of mints) { _knownMints.add(m.mint); }
  _totalTokens = _knownMints.size;

  d.prepare('DELETE FROM trader_vol_cache').run();
  d.prepare('DELETE FROM token_vol_cache').run();

  // rebuild aggregate caches from trades table
  d.prepare(`INSERT INTO trader_vol_cache (wallet_address, trade_count, total_volume_sol) SELECT wallet_address, COUNT(*), SUM(ABS(sol_amount)) FROM trades GROUP BY wallet_address`).run();
  d.prepare(`INSERT INTO token_vol_cache (mint, trade_count, total_volume_sol, sum_market_cap_sol) SELECT mint, COUNT(*), SUM(ABS(sol_amount)), SUM(COALESCE(market_cap_sol, 0)) FROM trades GROUP BY mint`).run();
}

function createTables(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY, label TEXT DEFAULT '', tags TEXT DEFAULT '', added_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tokens (
      mint TEXT PRIMARY KEY, name TEXT, symbol TEXT, supply REAL, created_at INTEGER,
      creator_address TEXT, pool_id TEXT, pool TEXT, market_cap_sol REAL, price REAL,
      token_program TEXT, decimals INTEGER
    );
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, signature TEXT NOT NULL, tx_type TEXT NOT NULL,
      wallet_address TEXT NOT NULL, mint TEXT NOT NULL,
      token_amount REAL, sol_amount REAL, price REAL, market_cap_sol REAL,
      pool TEXT, pool_id TEXT, tx_signers TEXT DEFAULT '',
      quote_mint TEXT, quote_amount REAL,
      timestamp INTEGER NOT NULL, block INTEGER, priority_fee REAL,
      UNIQUE(signature, wallet_address),
      FOREIGN KEY (wallet_address) REFERENCES wallets(address)
    );
    CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet_address, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_mint ON trades(mint, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_signature ON trades(signature);
    CREATE TABLE IF NOT EXISTS wallet_pnl (
      id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_address TEXT NOT NULL, mint TEXT NOT NULL,
      total_bought REAL DEFAULT 0, total_sold REAL DEFAULT 0,
      avg_buy_price REAL DEFAULT 0, avg_sell_price REAL DEFAULT 0,
      realized_pnl REAL DEFAULT 0, unrealized_pnl REAL DEFAULT 0,
      current_balance REAL DEFAULT 0, last_trade_at INTEGER DEFAULT 0, last_updated INTEGER DEFAULT 0,
      win_count INTEGER DEFAULT 0, loss_count INTEGER DEFAULT 0,
      UNIQUE(wallet_address, mint)
    );
    CREATE INDEX IF NOT EXISTS idx_pnl_wallet ON wallet_pnl(wallet_address);
    CREATE TABLE IF NOT EXISTS backfill_progress (
      hour_key TEXT PRIMARY KEY, status TEXT DEFAULT 'pending',
      events_total INTEGER DEFAULT 0, events_matched INTEGER DEFAULT 0,
      started_at TEXT, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS trader_vol_cache (
      wallet_address TEXT PRIMARY KEY, trade_count INTEGER DEFAULT 0, total_volume_sol REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS token_vol_cache (
      mint TEXT PRIMARY KEY, trade_count INTEGER DEFAULT 0, total_volume_sol REAL DEFAULT 0,
      sum_market_cap_sol REAL DEFAULT 0
    );
  `);
}

function migrateTradesTable(): void {
  const d = getDb();
  const row = d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='trades'").get() as { sql: string } | undefined;
  if (!row) return;
  const sql = row.sql.replace(/\s+/g, ' ');
  if (sql.includes('signature TEXT UNIQUE') && !sql.includes('UNIQUE(signature, wallet_address)')) {
    d.exec(`
      BEGIN;
      CREATE TABLE trades_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, signature TEXT NOT NULL, tx_type TEXT NOT NULL,
        wallet_address TEXT NOT NULL, mint TEXT NOT NULL,
        token_amount REAL, sol_amount REAL, price REAL, market_cap_sol REAL,
        pool TEXT, pool_id TEXT, tx_signers TEXT DEFAULT '',
        quote_mint TEXT, quote_amount REAL,
        timestamp INTEGER NOT NULL, block INTEGER, priority_fee REAL,
        UNIQUE(signature, wallet_address),
        FOREIGN KEY (wallet_address) REFERENCES wallets(address)
      );
      INSERT INTO trades_new (id, signature, tx_type, wallet_address, mint, token_amount, sol_amount, price, market_cap_sol, pool, pool_id, tx_signers, quote_mint, quote_amount, timestamp, block, priority_fee) SELECT id, signature, tx_type, wallet_address, mint, token_amount, sol_amount, price, market_cap_sol, pool, pool_id, COALESCE(tx_signers,''), COALESCE(quote_mint,NULL), COALESCE(quote_amount,NULL), timestamp, block, priority_fee FROM trades;
      DROP TABLE trades;
      ALTER TABLE trades_new RENAME TO trades;
      CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet_address, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_trades_mint ON trades(mint, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_trades_signature ON trades(signature);
      COMMIT;
    `);
  }
}

function migrateWalletPnlTable(): void {
  const d = getDb();
  const row = d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wallet_pnl'").get() as { sql: string } | undefined;
  if (!row) return;
  const sql = row.sql.replace(/\s+/g, ' ');
  if (!sql.includes('win_count')) {
    d.exec("ALTER TABLE wallet_pnl ADD COLUMN win_count INTEGER DEFAULT 0");
  }
  if (!sql.includes('loss_count')) {
    d.exec("ALTER TABLE wallet_pnl ADD COLUMN loss_count INTEGER DEFAULT 0");
  }
}

// ====== Wallets ======
export function addWallet(address: string, label = '', tags = ''): boolean {
  const result = getDb().prepare('INSERT OR IGNORE INTO wallets (address, label, tags) VALUES (?, ?, ?)').run(address, label, tags);
  if (result.changes > 0) _totalWallets++;
  return result.changes > 0;
}
export function removeWallet(address: string): void {
  getDb().prepare('DELETE FROM wallets WHERE address = ?').run(address);
  _totalWallets = (getDb().prepare('SELECT COUNT(*) as cnt FROM wallets').get() as { cnt: number }).cnt;
}
export function getWallets(): Wallet[] {
  return getDb().prepare('SELECT * FROM wallets ORDER BY added_at DESC').all() as Wallet[];
}
export function getWalletSet(): Set<string> {
  const rows = getDb().prepare('SELECT address FROM wallets').all() as { address: string }[];
  return new Set(rows.map(r => r.address));
}
export function importWallets(items: (string | [string, string?, string?])[]): number {
  const stmt = getDb().prepare('INSERT OR IGNORE INTO wallets (address, label, tags) VALUES (?, ?, ?)');
  const insertMany = getDb().transaction((items: (string | [string, string?, string?])[]) => {
    let count = 0;
    for (const item of items) {
      let addr: string, label = '', tags = '';
      if (typeof item === 'string') {
        addr = item.trim();
      } else if (Array.isArray(item)) {
        addr = (item[0] || '').trim();
        label = item[1] || '';
        tags = item[2] || '';
      } else {
        continue;
      }
          if (addr && stmt.run(addr, label, tags).changes > 0) { count++; }
    }
    return count;
  });
  const added = insertMany(items);
  _totalWallets += added;
  return added;
}
export function updateWallet(address: string, label: string, tags: string): void {
  getDb().prepare('UPDATE wallets SET label = ?, tags = ? WHERE address = ?').run(label, tags, address);
}

export function importWalletsChunked(
  items: (string | [string, string?, string?])[],
  onProgress: (done: number, total: number, inserted: number) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const BATCH = 50;
    const total = items.length;
    let insertedTotal = 0;
    let offset = 0;

    const stmt = getDb().prepare('INSERT OR IGNORE INTO wallets (address, label, tags) VALUES (?, ?, ?)');

    const processBatch = () => {
      if (offset >= total) { _totalWallets += insertedTotal; resolve(insertedTotal); return; }

      const chunk = items.slice(offset, offset + BATCH);
      const insertBatch = getDb().transaction((rows: typeof items) => {
        let count = 0;
        for (const item of rows) {
          let addr: string, label = '', tags = '';
          if (typeof item === 'string') {
            addr = item.trim();
          } else if (Array.isArray(item)) {
            addr = (item[0] || '').trim();
            label = item[1] || '';
            tags = item[2] || '';
          } else continue;
      if (addr && stmt.run(addr, label, tags).changes > 0) { count++; }
        }
        return count;
      });

      insertedTotal += insertBatch(chunk);
      offset += BATCH;
      onProgress(Math.min(offset, total), total, insertedTotal);

      if (offset < total) setImmediate(processBatch);
      else { _totalWallets += insertedTotal; resolve(insertedTotal); }
    };

    setImmediate(processBatch);
  });
}

// ====== Trades ======
export function insertTrade(t: Trade): boolean {
  try {
    const result = getDb().prepare(`
      INSERT OR IGNORE INTO trades
      (signature, tx_type, wallet_address, mint, token_amount, sol_amount,
       price, market_cap_sol, pool, pool_id, tx_signers,
       quote_mint, quote_amount, timestamp, block, priority_fee)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(t.signature, t.tx_type, t.wallet_address, t.mint,
      t.token_amount ?? 0, t.sol_amount ?? 0, t.price ?? 0, t.market_cap_sol ?? 0,
      t.pool ?? null, t.pool_id ?? null, t.tx_signers ?? '',
      t.quote_mint ?? null, t.quote_amount ?? null,
      t.timestamp ?? 0, t.block ?? 0, t.priority_fee ?? null);

    if (result.changes > 0) {
      _totalTrades++;
      if (t.timestamp && t.timestamp > _latestTradeTs) _latestTradeTs = t.timestamp;
      if (!_knownMints.has(t.mint)) { _knownMints.add(t.mint); _totalTokens++; }

      // atomic upsert — ON CONFLICT ensures no double-counting
      _getIncTraderStmt().run(t.wallet_address, Math.abs(t.sol_amount ?? 0));
      _getIncTokenStmt().run(t.mint, Math.abs(t.sol_amount ?? 0), t.market_cap_sol ?? 0);
    }
    return true;
  } catch (e) { console.error('insertTrade failed:', e); return false; }
}
export function getRecentTrades(limit = 50): Trade[] {
  return getDb().prepare('SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?').all(limit) as Trade[];
}
export function getWalletTrades(addr: string, limit = 500): Trade[] {
  return getDb().prepare('SELECT * FROM trades WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT ?').all(addr, limit) as Trade[];
}
export function getTokenTrades(mint: string, limit = 500): Trade[] {
  return getDb().prepare('SELECT * FROM trades WHERE mint = ? ORDER BY timestamp DESC LIMIT ?').all(mint, limit) as Trade[];
}

// ====== Token ======
export function insertToken(t: {
  mint: string; name?: string | null; symbol?: string | null; supply?: number | null;
  createdAt?: number | null; creatorAddress?: string | null; poolId?: string | null;
  pool?: string | null; marketCapSol?: number | null; price?: number | null;
  tokenProgram?: string | null; decimals?: number | null;
}): void {
  getDb().prepare(`INSERT OR REPLACE INTO tokens (mint, name, symbol, supply, created_at, creator_address, pool_id, pool, market_cap_sol, price, token_program, decimals) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(t.mint, t.name ?? null, t.symbol ?? null, t.supply ?? null, t.createdAt ?? null,
      t.creatorAddress ?? null, t.poolId ?? null, t.pool ?? null,
      t.marketCapSol ?? null, t.price ?? null, t.tokenProgram ?? null, t.decimals ?? null);
}
export function getTokens(): (TokenVolume & { mint: string; name?: string; symbol?: string })[] {
  return getDb().prepare('SELECT * FROM tokens ORDER BY market_cap_sol DESC').all() as any[];
}

// ====== Dashboard ======
export function getDashboardStats(): DashboardStats {
  return {
    totalTrades: _totalTrades,
    totalWallets: _totalWallets,
    totalTokens: _totalTokens,
    latestTradeTs: _latestTradeTs,
  };
}
export function getTopTradersByVolume(limit = 20): TraderVolume[] {
  return getDb().prepare('SELECT wallet_address, trade_count, total_volume_sol FROM trader_vol_cache ORDER BY total_volume_sol DESC LIMIT ?').all(limit) as TraderVolume[];
}
export function getTopTokensByVolume(limit = 20): TokenVolume[] {
  return getDb().prepare('SELECT mint, trade_count, total_volume_sol, CASE WHEN trade_count > 0 THEN sum_market_cap_sol / trade_count ELSE 0 END as avg_market_cap FROM token_vol_cache ORDER BY trade_count DESC LIMIT ?').all(limit) as TokenVolume[];
}
export function getOverlappingTokens(minWallets = 2): OverlapRow[] {
  return getDb().prepare(`
    SELECT t.mint, t.wallet_count, t.trade_count, t.buy_volume, t.sell_volume,
           t.latest_market_cap, t.last_trade, t.trader_list,
           COALESCE(pnl.remaining, 0) as remaining,
           tok.name as token_name, tok.symbol as token_symbol
    FROM (
      SELECT mint, COUNT(DISTINCT wallet_address) as wallet_count, COUNT(*) as trade_count,
             SUM(CASE WHEN tx_type='buy' THEN ABS(sol_amount) ELSE 0 END) as buy_volume,
             SUM(CASE WHEN tx_type='sell' THEN ABS(sol_amount) ELSE 0 END) as sell_volume,
             MAX(market_cap_sol) as latest_market_cap, MAX(timestamp) as last_trade,
             GROUP_CONCAT(DISTINCT wallet_address) as trader_list
      FROM trades GROUP BY mint HAVING wallet_count >= ?
    ) t
    LEFT JOIN (
      SELECT mint, COUNT(*) as remaining
      FROM wallet_pnl WHERE current_balance > 0
      GROUP BY mint
    ) pnl ON t.mint = pnl.mint
    LEFT JOIN tokens tok ON t.mint = tok.mint
    ORDER BY t.last_trade DESC
  `).all(minWallets) as OverlapRow[];
}

// ====== Stats ======
export function getWalletStats(addr: string): WalletStats {
  return (getDb().prepare(`
    SELECT COUNT(*) as total_trades,
           SUM(CASE WHEN tx_type = 'buy' THEN 1 ELSE 0 END) as buys,
           SUM(CASE WHEN tx_type = 'sell' THEN 1 ELSE 0 END) as sells,
           SUM(CASE WHEN tx_type = 'buy' THEN ABS(sol_amount) ELSE 0 END) as total_buy_volume,
           SUM(CASE WHEN tx_type = 'sell' THEN ABS(sol_amount) ELSE 0 END) as total_sell_volume,
           COUNT(DISTINCT mint) as unique_tokens,
           AVG(CASE WHEN tx_type = 'buy' THEN price END) as avg_buy_price,
           AVG(CASE WHEN tx_type = 'sell' THEN price END) as avg_sell_price,
           MAX(timestamp) as last_trade, MIN(timestamp) as first_trade
    FROM trades WHERE wallet_address = ?
  `).get(addr) as WalletStats) || {};
}
export function getTokenStats(mint: string): TokenStats {
  return (getDb().prepare(`
    SELECT COUNT(*) as total_trades, COUNT(DISTINCT wallet_address) as unique_wallets,
           SUM(CASE WHEN tx_type = 'buy' THEN ABS(sol_amount) ELSE 0 END) as buy_volume,
           SUM(CASE WHEN tx_type = 'sell' THEN ABS(sol_amount) ELSE 0 END) as sell_volume,
           AVG(market_cap_sol) as avg_market_cap, MAX(market_cap_sol) as peak_market_cap,
           MAX(timestamp) as last_trade, MIN(timestamp) as first_trade
    FROM trades WHERE mint = ?
  `).get(mint) as TokenStats) || {};
}

// ====== PnL ======
export function getWalletPnL(addr?: string | null): PnLRow[] {
  const where = addr ? 'WHERE wallet_address = ?' : '';
  const params = addr ? [addr] : [];
  return getDb().prepare(`SELECT * FROM wallet_pnl ${where}`).all(...params) as PnLRow[];
}
function computePnL(walletAddress: string, mint: string): PnLRow | null {
  const rows = getDb().prepare('SELECT * FROM trades WHERE wallet_address = ? AND mint = ? ORDER BY timestamp ASC').all(walletAddress, mint) as Trade[];
  if (!rows.length) return null;

  // FIFO lot tracking: array of { qty, pricePerToken }
  const lots: { qty: number; pricePerToken: number }[] = [];
  let totalBoughtQty = 0, totalBoughtSol = 0, totalSoldQty = 0, totalSoldSol = 0;
  let realizedPnl = 0;
  let winCount = 0, lossCount = 0;
  let lastTs = 0;
  let soldOutOfNowhere = 0; // sells of tokens never bought

  for (const r of rows) {
    const qty = Math.abs(r.token_amount || 0);
    const sol = Math.abs(r.sol_amount || 0);
    lastTs = Math.max(lastTs, r.timestamp || 0);

    if (r.tx_type === 'buy') {
      totalBoughtQty += qty;
      totalBoughtSol += sol;
      lots.push({ qty, pricePerToken: qty > 0 ? sol / qty : 0 });
    } else {
      totalSoldQty += qty;
      totalSoldSol += sol;
      const sellPricePerToken = qty > 0 ? sol / qty : 0;
      let remaining = qty;
      let sellPnl = 0;
      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        const consumed = Math.min(lot.qty, remaining);
        const tradePnl = consumed * (sellPricePerToken - lot.pricePerToken);
        sellPnl += tradePnl;
        realizedPnl += tradePnl;
        lot.qty -= consumed;
        remaining -= consumed;
        if (lot.qty < 1e-12) lots.shift();
      }
      if (remaining > 0) {
        soldOutOfNowhere += remaining * sellPricePerToken;
      }
      if (sellPnl >= 0) winCount++;
      else lossCount++;
    }
  }

  const remainingQty = Math.max(0, totalBoughtQty - totalSoldQty);
  // unrealized PnL is remaining tokens * (average sell price - average buy price) as an estimate
  const avgBuy = totalBoughtQty > 0 ? totalBoughtSol / totalBoughtQty : 0;
  const avgSell = totalSoldQty > 0 ? totalSoldSol / totalSoldQty : 0;
  // include sells of untracked purchases as pure profit
  realizedPnl += soldOutOfNowhere;
  const unrealized = remainingQty > 0 ? remainingQty * (avgSell - avgBuy) : 0;

  return {
    wallet_address: walletAddress, mint,
    total_bought: totalBoughtQty, total_sold: totalSoldQty,
    avg_buy_price: avgBuy, avg_sell_price: avgSell,
    realized_pnl: realizedPnl, unrealized_pnl: unrealized,
    current_balance: remainingQty,
    last_trade_at: lastTs, last_updated: Date.now(),
    win_count: winCount, loss_count: lossCount,
  };
}
export function recomputeAllPnL(): void {
  const d = getDb();
  const wallets = d.prepare('SELECT address FROM wallets').all() as { address: string }[];
  const upsert = d.prepare(`INSERT OR REPLACE INTO wallet_pnl (wallet_address, mint, total_bought, total_sold, avg_buy_price, avg_sell_price, realized_pnl, unrealized_pnl, current_balance, last_trade_at, last_updated, win_count, loss_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const txn = d.transaction(() => {
    for (const w of wallets) {
      const pairs = d.prepare('SELECT DISTINCT mint FROM trades WHERE wallet_address = ?').all(w.address) as { mint: string }[];
      for (const p of pairs) {
        const pnl = computePnL(w.address, p.mint);
        if (pnl) upsert.run(pnl.wallet_address, pnl.mint, pnl.total_bought, pnl.total_sold, pnl.avg_buy_price, pnl.avg_sell_price, pnl.realized_pnl, pnl.unrealized_pnl, pnl.current_balance, pnl.last_trade_at, pnl.last_updated, pnl.win_count, pnl.loss_count);
      }
    }
  });
  txn();
}

// ====== Backfill ======
export function getBackfillProgress(): BackfillProgress[] {
  return getDb().prepare('SELECT * FROM backfill_progress ORDER BY hour_key DESC').all() as BackfillProgress[];
}
export function isBackfillComplete(hourKey: string): boolean {
  return getDb().prepare("SELECT 1 FROM backfill_progress WHERE hour_key = ? AND status = 'complete'").get(hourKey) != null;
}
export function setBackfillProgress(hourKey: string, status: string, eventsTotal = 0, eventsMatched = 0): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO backfill_progress (hour_key, status, events_total, events_matched, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'complete' THEN ? ELSE NULL END)
    ON CONFLICT(hour_key) DO UPDATE SET
      status = excluded.status,
      events_total = excluded.events_total,
      events_matched = excluded.events_matched,
      completed_at = CASE
        WHEN backfill_progress.status != 'complete' AND excluded.status = 'complete' THEN excluded.completed_at
        ELSE backfill_progress.completed_at
      END
  `).run(hourKey, status, eventsTotal, eventsMatched, now, status, now);
}
