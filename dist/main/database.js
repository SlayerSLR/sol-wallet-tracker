"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.getDb = getDb;
exports.addWallet = addWallet;
exports.removeWallet = removeWallet;
exports.getWallets = getWallets;
exports.getWalletSet = getWalletSet;
exports.importWallets = importWallets;
exports.updateWallet = updateWallet;
exports.importWalletsChunked = importWalletsChunked;
exports.insertTrade = insertTrade;
exports.getRecentTrades = getRecentTrades;
exports.getWalletTrades = getWalletTrades;
exports.getTokenTrades = getTokenTrades;
exports.insertToken = insertToken;
exports.getTokens = getTokens;
exports.getDashboardStats = getDashboardStats;
exports.getTopTradersByVolume = getTopTradersByVolume;
exports.getTopTokensByVolume = getTopTokensByVolume;
exports.getOverlappingTokens = getOverlappingTokens;
exports.getWalletStats = getWalletStats;
exports.getTokenStats = getTokenStats;
exports.getWalletPnL = getWalletPnL;
exports.recomputeAllPnL = recomputeAllPnL;
exports.getBackfillProgress = getBackfillProgress;
exports.isBackfillComplete = isBackfillComplete;
exports.setBackfillProgress = setBackfillProgress;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
let db = null;
// ====== Init ======
function initDatabase(dbPath) {
    db = new better_sqlite3_1.default(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -8000');
    db.pragma('foreign_keys = ON');
    createTables();
    migrateTradesTable();
}
function getDb() {
    if (!db)
        throw new Error('Database not initialized');
    return db;
}
function createTables() {
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
      UNIQUE(wallet_address, mint)
    );
    CREATE INDEX IF NOT EXISTS idx_pnl_wallet ON wallet_pnl(wallet_address);
    CREATE TABLE IF NOT EXISTS backfill_progress (
      hour_key TEXT PRIMARY KEY, status TEXT DEFAULT 'pending',
      events_total INTEGER DEFAULT 0, events_matched INTEGER DEFAULT 0,
      started_at TEXT, completed_at TEXT
    );
  `);
}
function migrateTradesTable() {
    const d = getDb();
    const row = d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='trades'").get();
    if (!row)
        return;
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
// ====== Wallets ======
function addWallet(address, label = '', tags = '') {
    getDb().prepare('INSERT OR IGNORE INTO wallets (address, label, tags) VALUES (?, ?, ?)').run(address, label, tags);
    return true;
}
function removeWallet(address) {
    getDb().prepare('DELETE FROM wallets WHERE address = ?').run(address);
}
function getWallets() {
    return getDb().prepare('SELECT * FROM wallets ORDER BY added_at DESC').all();
}
function getWalletSet() {
    const rows = getDb().prepare('SELECT address FROM wallets').all();
    return new Set(rows.map(r => r.address));
}
function importWallets(items) {
    const stmt = getDb().prepare('INSERT OR IGNORE INTO wallets (address, label, tags) VALUES (?, ?, ?)');
    const insertMany = getDb().transaction((items) => {
        let count = 0;
        for (const item of items) {
            let addr, label = '', tags = '';
            if (typeof item === 'string') {
                addr = item.trim();
            }
            else if (Array.isArray(item)) {
                addr = (item[0] || '').trim();
                label = item[1] || '';
                tags = item[2] || '';
            }
            else {
                continue;
            }
            if (addr) {
                stmt.run(addr, label, tags);
                count++;
            }
        }
        return count;
    });
    return insertMany(items);
}
function updateWallet(address, label, tags) {
    getDb().prepare('UPDATE wallets SET label = ?, tags = ? WHERE address = ?').run(label, tags, address);
}
function importWalletsChunked(items, onProgress) {
    return new Promise((resolve) => {
        const BATCH = 50;
        const total = items.length;
        let insertedTotal = 0;
        let offset = 0;
        const stmt = getDb().prepare('INSERT OR IGNORE INTO wallets (address, label, tags) VALUES (?, ?, ?)');
        const processBatch = () => {
            if (offset >= total) {
                resolve(insertedTotal);
                return;
            }
            const chunk = items.slice(offset, offset + BATCH);
            const insertBatch = getDb().transaction((rows) => {
                let count = 0;
                for (const item of rows) {
                    let addr, label = '', tags = '';
                    if (typeof item === 'string') {
                        addr = item.trim();
                    }
                    else if (Array.isArray(item)) {
                        addr = (item[0] || '').trim();
                        label = item[1] || '';
                        tags = item[2] || '';
                    }
                    else
                        continue;
                    if (addr) {
                        stmt.run(addr, label, tags);
                        count++;
                    }
                }
                return count;
            });
            insertedTotal += insertBatch(chunk);
            offset += BATCH;
            onProgress(Math.min(offset, total), total, insertedTotal);
            if (offset < total)
                setImmediate(processBatch);
            else
                resolve(insertedTotal);
        };
        setImmediate(processBatch);
    });
}
// ====== Trades ======
function insertTrade(t) {
    try {
        getDb().prepare(`
      INSERT OR IGNORE INTO trades
      (signature, tx_type, wallet_address, mint, token_amount, sol_amount,
       price, market_cap_sol, pool, pool_id, tx_signers,
       quote_mint, quote_amount, timestamp, block, priority_fee)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(t.signature, t.tx_type, t.wallet_address, t.mint, t.token_amount ?? 0, t.sol_amount ?? 0, t.price ?? 0, t.market_cap_sol ?? 0, t.pool ?? null, t.pool_id ?? null, t.tx_signers ?? '', t.quote_mint ?? null, t.quote_amount ?? null, t.timestamp ?? 0, t.block ?? 0, t.priority_fee ?? null);
        return true;
    }
    catch (e) {
        console.error('insertTrade failed:', e);
        return false;
    }
}
function getRecentTrades(limit = 50) {
    return getDb().prepare('SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?').all(limit);
}
function getWalletTrades(addr, limit = 500) {
    return getDb().prepare('SELECT * FROM trades WHERE wallet_address = ? ORDER BY timestamp DESC LIMIT ?').all(addr, limit);
}
function getTokenTrades(mint, limit = 500) {
    return getDb().prepare('SELECT * FROM trades WHERE mint = ? ORDER BY timestamp DESC LIMIT ?').all(mint, limit);
}
// ====== Token ======
function insertToken(t) {
    getDb().prepare(`INSERT OR REPLACE INTO tokens (mint, name, symbol, supply, created_at, creator_address, pool_id, pool, market_cap_sol, price, token_program, decimals) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(t.mint, t.name ?? null, t.symbol ?? null, t.supply ?? null, t.createdAt ?? null, t.creatorAddress ?? null, t.poolId ?? null, t.pool ?? null, t.marketCapSol ?? null, t.price ?? null, t.tokenProgram ?? null, t.decimals ?? null);
}
function getTokens() {
    return getDb().prepare('SELECT * FROM tokens ORDER BY market_cap_sol DESC').all();
}
// ====== Dashboard ======
function getDashboardStats() {
    const d = getDb();
    return {
        totalTrades: d.prepare('SELECT COUNT(*) as cnt FROM trades').get().cnt,
        totalWallets: d.prepare('SELECT COUNT(*) as cnt FROM wallets').get().cnt,
        totalTokens: d.prepare('SELECT COUNT(DISTINCT mint) as cnt FROM trades').get().cnt,
        latestTradeTs: d.prepare('SELECT timestamp FROM trades ORDER BY timestamp DESC LIMIT 1').get()?.timestamp ?? 0,
    };
}
function getTopTradersByVolume(limit = 20) {
    return getDb().prepare(`SELECT wallet_address, COUNT(*) as trade_count, SUM(ABS(sol_amount)) as total_volume_sol FROM trades GROUP BY wallet_address ORDER BY total_volume_sol DESC LIMIT ?`).all(limit);
}
function getTopTokensByVolume(limit = 20) {
    return getDb().prepare(`SELECT mint, COUNT(*) as trade_count, SUM(ABS(sol_amount)) as total_volume_sol, AVG(market_cap_sol) as avg_market_cap FROM trades GROUP BY mint ORDER BY trade_count DESC LIMIT ?`).all(limit);
}
function getOverlappingTokens(minWallets = 2) {
    return getDb().prepare(`
    SELECT mint, COUNT(DISTINCT wallet_address) as wallet_count, COUNT(*) as trade_count,
           SUM(CASE WHEN tx_type='buy' THEN ABS(sol_amount) ELSE 0 END) as buy_volume,
           SUM(CASE WHEN tx_type='sell' THEN ABS(sol_amount) ELSE 0 END) as sell_volume,
           MAX(market_cap_sol) as latest_market_cap, MAX(timestamp) as last_trade,
           GROUP_CONCAT(DISTINCT wallet_address) as trader_list
    FROM trades GROUP BY mint HAVING wallet_count >= ? ORDER BY wallet_count DESC, trade_count DESC
  `).all(minWallets);
}
// ====== Stats ======
function getWalletStats(addr) {
    return getDb().prepare(`
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
  `).get(addr) || {};
}
function getTokenStats(mint) {
    return getDb().prepare(`
    SELECT COUNT(*) as total_trades, COUNT(DISTINCT wallet_address) as unique_wallets,
           SUM(CASE WHEN tx_type = 'buy' THEN ABS(sol_amount) ELSE 0 END) as buy_volume,
           SUM(CASE WHEN tx_type = 'sell' THEN ABS(sol_amount) ELSE 0 END) as sell_volume,
           AVG(market_cap_sol) as avg_market_cap, MAX(market_cap_sol) as peak_market_cap,
           MAX(timestamp) as last_trade, MIN(timestamp) as first_trade
    FROM trades WHERE mint = ?
  `).get(mint) || {};
}
// ====== PnL ======
function getWalletPnL(addr) {
    const where = addr ? 'WHERE wallet_address = ?' : '';
    const params = addr ? [addr] : [];
    return getDb().prepare(`SELECT * FROM wallet_pnl ${where}`).all(...params);
}
function computePnL(walletAddress, mint) {
    const rows = getDb().prepare('SELECT * FROM trades WHERE wallet_address = ? AND mint = ? ORDER BY timestamp ASC').all(walletAddress, mint);
    if (!rows.length)
        return null;
    // FIFO lot tracking: array of { qty, pricePerToken }
    const lots = [];
    let totalBoughtQty = 0, totalBoughtSol = 0, totalSoldQty = 0, totalSoldSol = 0;
    let realizedPnl = 0;
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
        }
        else {
            totalSoldQty += qty;
            totalSoldSol += sol;
            const sellPricePerToken = qty > 0 ? sol / qty : 0;
            let remaining = qty;
            while (remaining > 0 && lots.length > 0) {
                const lot = lots[0];
                const consumed = Math.min(lot.qty, remaining);
                realizedPnl += consumed * (sellPricePerToken - lot.pricePerToken);
                lot.qty -= consumed;
                remaining -= consumed;
                if (lot.qty < 1e-12)
                    lots.shift();
            }
            if (remaining > 0) {
                soldOutOfNowhere += remaining * sellPricePerToken;
            }
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
    };
}
function recomputeAllPnL() {
    const d = getDb();
    const wallets = d.prepare('SELECT address FROM wallets').all();
    const upsert = d.prepare(`INSERT OR REPLACE INTO wallet_pnl (wallet_address, mint, total_bought, total_sold, avg_buy_price, avg_sell_price, realized_pnl, unrealized_pnl, current_balance, last_trade_at, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const txn = d.transaction(() => {
        for (const w of wallets) {
            const pairs = d.prepare('SELECT DISTINCT mint FROM trades WHERE wallet_address = ?').all(w.address);
            for (const p of pairs) {
                const pnl = computePnL(w.address, p.mint);
                if (pnl)
                    upsert.run(pnl.wallet_address, pnl.mint, pnl.total_bought, pnl.total_sold, pnl.avg_buy_price, pnl.avg_sell_price, pnl.realized_pnl, pnl.unrealized_pnl, pnl.current_balance, pnl.last_trade_at, pnl.last_updated);
            }
        }
    });
    txn();
}
// ====== Backfill ======
function getBackfillProgress() {
    return getDb().prepare('SELECT * FROM backfill_progress ORDER BY hour_key DESC').all();
}
function isBackfillComplete(hourKey) {
    return getDb().prepare("SELECT 1 FROM backfill_progress WHERE hour_key = ? AND status = 'complete'").get(hourKey) != null;
}
function setBackfillProgress(hourKey, status, eventsTotal = 0, eventsMatched = 0) {
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
