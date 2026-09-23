// Inizializza lo schema event-sourced nel DB esistente.
// Da eseguire UNA volta se l'app web è stata avviata prima del bot.

import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'coach-beard.db');

if (!existsSync(DB_PATH)) {
  console.error('❌ coach-beard.db non trovato in:', DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Inizializzazione schema event-sourced in:', DB_PATH);

// 1. Schema auction_events
db.exec(`
  CREATE TABLE IF NOT EXISTS auction_events (
    sequence_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT NOT NULL,
    ts               TEXT NOT NULL,
    idempotency_key  TEXT UNIQUE,
    payload_json     TEXT NOT NULL,
    compensated_seq  INTEGER,
    FOREIGN KEY (compensated_seq) REFERENCES auction_events(sequence_id)
  );
  CREATE INDEX IF NOT EXISTS idx_events_type ON auction_events(type);
  CREATE INDEX IF NOT EXISTS idx_events_comp ON auction_events(compensated_seq);
`);

// Aggiungi colonna idempotency_key se manca
const cols = db.prepare("PRAGMA table_info(auction_events)").all() as Array<{ name: string }>;
if (!cols.some((c) => c.name === 'idempotency_key')) {
  console.log('  Aggiungo colonna idempotency_key...');
  db.exec("ALTER TABLE auction_events ADD COLUMN idempotency_key TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uniq_idem ON auction_events(idempotency_key) WHERE idempotency_key IS NOT NULL");
}

console.log('✓ Schema event-sourced pronto');
console.log('  Tabelle: managers, league_config, auction_events');

db.close();
