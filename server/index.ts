import http from 'node:http';
import express from 'express';
import { initDatabase, getDb } from '../main/database.js';
import { StreamWorker } from '../main/stream-worker.js';
import { BackfillWorker } from '../main/backfill-worker.js';
import { SolPriceService } from '../main/price-service.js';
import { createRouter } from './routes.js';
import { EventBus } from './ws-events.js';

function parseArgs(): { dbPath: string } {
  for (const arg of process.argv) {
    if (arg.startsWith('--db-path=')) return { dbPath: arg.slice('--db-path='.length) };
    if (arg.startsWith('--db-path')) {
      const idx = process.argv.indexOf(arg);
      if (idx + 1 < process.argv.length) return { dbPath: process.argv[idx + 1] };
    }
  }
  console.error('Usage: node server/index.js --db-path=<path>');
  process.exit(1);
}

const { dbPath } = parseArgs();

initDatabase(dbPath);

const streamWorker = new StreamWorker();
const backfillWorker = new BackfillWorker();
const priceService = new SolPriceService();

const app = express();
app.use(express.json({ limit: '10mb' }));

const httpServer = http.createServer(app);
const eventBus = new EventBus(httpServer);

app.use(createRouter(streamWorker, backfillWorker, priceService, eventBus));

// Wire workers → WS push
streamWorker.onTrade((t) => eventBus.pushTrade(t));
streamWorker.onStatus((s) => eventBus.pushStreamStatus(s));
backfillWorker.onProgress((d) => eventBus.pushBackfillProgress(d));
backfillWorker.onStatus((m) => eventBus.pushBackfillStatus(m));
priceService.onPrice((p) => eventBus.pushSolPrice(p));

httpServer.listen(0, '127.0.0.1', () => {
  const addr = httpServer.address() as { port: number };
  const readyMsg = JSON.stringify({ ready: true, port: addr.port });
  process.stdout.write(readyMsg + '\n');

  streamWorker.start();
  priceService.start();
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  streamWorker.stop();
  backfillWorker.stop();
  priceService.stop();
  try { const db = getDb(); if (db) db.close(); } catch {}
  process.exit(0);
}
