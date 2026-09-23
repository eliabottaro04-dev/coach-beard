#!/usr/bin/env node
/**
 * scripts/ingest.mjs
 *
 * Popola il database Postgres remoto (Neon / Vercel Postgres) con:
 *   1) Schema (CREATE TABLE IF NOT EXISTS) — idempotente
 *   2) Seed managers (8 slot) — solo se tabella vuota
 *   3) Seed league_config — solo se non presente
 *   4) OPZIONALE: migrazione eventi da SQLite locale con --from-sqlite
 *
 * Uso:
 *   DATABASE_URL=postgres://... npm run ingest
 *   DATABASE_URL=postgres://... npm run ingest -- --from-sqlite
 *   DATABASE_URL=postgres://... npm run ingest -- --from-sqlite /percorso/al/db.db
 *
 * Per popolare il DB remoto la prima volta:
 *   1) Crea progetto Neon → copia DATABASE_URL
 *   2) Esporta DATABASE_URL (oppure mettila in .env.local)
 *   3) Lancia `npm run ingest` (crea tabelle + seed)
 *   4) Se vuoi migrare un'asta locale in corso:
 *      `npm run ingest -- --from-sqlite` (legge ./coach-beard.db)
 */

import pg from 'pg';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const FROM_SQLITE = args.includes('--from-sqlite');
const SQLITE_PATH = (() => {
  if (!FROM_SQLITE) return null;
  // Cerca argomento esplicito dopo --from-sqlite
  const idx = args.indexOf('--from-sqlite');
  const explicit = args[idx + 1];
  if (explicit && !explicit.startsWith('--')) return explicit;
  // Default: ./coach-beard.db
  return join(ROOT, 'coach-beard.db');
})();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL mancante.');
  console.error('   Esempio:');
  console.error('     export DATABASE_URL=postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/fantacalcio?sslmode=require');
  console.error('     npm run ingest');
  process.exit(1);
}

// ── Schema e costanti (inline, no import da src) ─────────────────────

const LEAGUE_RULES = {
  leagueName: 'Classica',
  managerCount: 8,
  initialCredits: 500,
  roster: { P: 3, D: 8, C: 8, A: 6 },
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS managers (
    id        BIGINT PRIMARY KEY,
    name      TEXT    NOT NULL DEFAULT '',
    is_owner  BIGINT  NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS league_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auction_events (
    sequence_id      BIGSERIAL PRIMARY KEY,
    type             TEXT NOT NULL,
    ts               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    idempotency_key  TEXT,
    payload_json     TEXT NOT NULL,
    compensated_seq  BIGINT
      REFERENCES auction_events(sequence_id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_type ON auction_events(type);
  CREATE INDEX IF NOT EXISTS idx_events_comp ON auction_events(compensated_seq);
`;

const UNIQ_IDEM_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_idem
    ON auction_events(idempotency_key)
    WHERE idempotency_key IS NOT NULL
`;

const CONFIG_ROWS = [
  ['league_name', LEAGUE_RULES.leagueName],
  ['initial_credits', String(LEAGUE_RULES.initialCredits)],
  ['roster_P', String(LEAGUE_RULES.roster.P)],
  ['roster_D', String(LEAGUE_RULES.roster.D)],
  ['roster_C', String(LEAGUE_RULES.roster.C)],
  ['roster_A', String(LEAGUE_RULES.roster.A)],
  ['manager_count', String(LEAGUE_RULES.managerCount)],
];

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🗄️  Ingest Coach Beard → Postgres');
  console.log('   DATABASE_URL:', DATABASE_URL.replace(/:[^:@]+@/, ':***@'));

  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });

  try {
    // 1) Schema
    console.log('   [1/4] Creazione schema...');
    await pool.query(SCHEMA);
    try { await pool.query(UNIQ_IDEM_INDEX); } catch { /* already exists */ }
    console.log('         ✓ Tabelle pronte');

    // 2) Seed managers (se vuoto)
    console.log('   [2/4] Seed managers...');
    const mgrCount = await pool.query('SELECT COUNT(*) as cnt FROM managers');
    if (parseInt(mgrCount.rows[0].cnt) === 0) {
      for (let i = 1; i <= LEAGUE_RULES.managerCount; i++) {
        await pool.query(
          `INSERT INTO managers (id, name, is_owner) VALUES ($1, $2, $3)`,
          [i, '', i === 1 ? 1 : 0]
        );
      }
      console.log(`         ✓ ${LEAGUE_RULES.managerCount} manager seedati`);
    } else {
      console.log(`         ⏭️  Tabella managers già popolata (${mgrCount.rows[0].cnt} righe)`);
    }

    // 3) Seed league_config (se mancante)
    console.log('   [3/4] Seed league_config...');
    for (const [k, v] of CONFIG_ROWS) {
      await pool.query(
        `INSERT INTO league_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [k, v]
      );
    }
    console.log(`         ✓ ${CONFIG_ROWS.length} config scritte`);

    // 4) Migrazione da SQLite (opzionale)
    if (FROM_SQLITE) {
      console.log(`   [4/4] Migrazione da SQLite: ${SQLITE_PATH}`);
      if (!existsSync(SQLITE_PATH)) {
        console.error(`         ❌ File non trovato: ${SQLITE_PATH}`);
        process.exit(1);
      }
      // Import dinamico di better-sqlite3
      const Database = (await import('better-sqlite3')).default;
      const sqlite = new Database(SQLITE_PATH, { readonly: true });

      // 4a) Manager: UPDATE i nomi/is_owner se esistono, INSERT se mancanti
      const sqliteMgrs = sqlite.prepare('SELECT id, name, is_owner FROM managers').all();
      let updatedMgrs = 0;
      for (const m of sqliteMgrs) {
        const r = await pool.query(
          `INSERT INTO managers (id, name, is_owner) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_owner = EXCLUDED.is_owner`,
          [m.id, m.name ?? '', m.is_owner]
        );
        updatedMgrs += r.rowCount > 0 ? 1 : 0;
      }
      console.log(`         ✓ ${updatedMgrs} manager importati/aggiornati`);

      // 4b) Eventi: mappa oldId → newId e INSERT in ordine
      const sqliteEvents = sqlite.prepare(
        `SELECT sequence_id, type, ts, idempotency_key, payload_json, compensated_seq
         FROM auction_events ORDER BY sequence_id ASC`
      ).all();
      const oldToNew = new Map();
      let imported = 0, skipped = 0;

      for (const e of sqliteEvents) {
        // Controlla se già presente per idempotency_key
        if (e.idempotency_key) {
          const exists = await pool.query(
            `SELECT sequence_id FROM auction_events WHERE idempotency_key = $1`,
            [e.idempotency_key]
          );
          if (exists.rows.length > 0) {
            oldToNew.set(e.sequence_id, exists.rows[0].sequence_id);
            skipped++;
            continue;
          }
        }

        // compensated_seq può essere null oppure un oldId
        const newComp = e.compensated_seq != null ? oldToNew.get(e.compensated_seq) ?? null : null;

        const ins = await pool.query(
          `INSERT INTO auction_events (type, ts, idempotency_key, payload_json, compensated_seq)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING sequence_id`,
          [e.type, e.ts, e.idempotency_key ?? null, e.payload_json, newComp]
        );
        oldToNew.set(e.sequence_id, ins.rows[0].sequence_id);
        imported++;
      }
      sqlite.close();
      console.log(`         ✓ ${imported} eventi importati (${skipped} già presenti)`);
    } else {
      console.log('   [4/4] Migrazione SQLite: saltata (no --from-sqlite)');
    }

    // Verifica finale
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM managers)       as managers,
        (SELECT COUNT(*) FROM league_config)  as config,
        (SELECT COUNT(*) FROM auction_events) as events
    `);
    const stats = r.rows[0];
    console.log('');
    console.log('✅ Ingest completato!');
    console.log(`   managers:      ${stats.managers}`);
    console.log(`   config:        ${stats.config}`);
    console.log(`   events:        ${stats.events}`);
  } catch (err) {
    console.error('❌ Errore:', err.message);
    if (err.code) console.error(`   code: ${err.code}`);
    if (err.detail) console.error(`   detail: ${err.detail}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
