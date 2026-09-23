// Adapter SQLite per Coach Beard.
// Espone la stessa interfaccia di db-postgres.ts per il factory pattern.

import Database from 'better-sqlite3';
import { LEAGUE_RULES } from './league-rules';

export type DbRunResult = {
  changes: number;
  lastInsertRowid: string | number;
};

export interface DbStatement {
  all(...params: any[]): any[];
  get(...params: any[]): any;
  run(...params: any[]): DbRunResult;
}

export interface DbInterface {
  prepare(sql: string): DbStatement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}

// ─── SqliteDb ────────────────────────────────────────────────────────────────

export class SqliteDb implements DbInterface {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  init(): this {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS managers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        is_owner INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS league_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auction_events (
        sequence_id      INTEGER PRIMARY KEY AUTOINCREMENT,
        type             TEXT NOT NULL,
        ts               TEXT NOT NULL,
        idempotency_key  TEXT,
        payload_json     TEXT NOT NULL,
        compensated_seq  INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_events_type ON auction_events(type);
      CREATE INDEX IF NOT EXISTS idx_events_comp ON auction_events(compensated_seq);
    `);

    // Migration: aggiunge colonna idempotency_key se non esiste (vecchio DB)
    const cols = this.db.prepare("PRAGMA table_info(auction_events)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'idempotency_key')) {
      this.db.exec("ALTER TABLE auction_events ADD COLUMN idempotency_key TEXT");
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uniq_idem ON auction_events(idempotency_key) WHERE idempotency_key IS NOT NULL");
    }

    this.initConfig();
    this.seedManagers();
    return this;
  }

  initConfig() {
    const configs = [
      ['league_name', LEAGUE_RULES.leagueName],
      ['initial_credits', String(LEAGUE_RULES.initialCredits)],
      ['roster_P', String(LEAGUE_RULES.roster.P)],
      ['roster_D', String(LEAGUE_RULES.roster.D)],
      ['roster_C', String(LEAGUE_RULES.roster.C)],
      ['roster_A', String(LEAGUE_RULES.roster.A)],
      ['manager_count', String(LEAGUE_RULES.managerCount)],
    ];
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO league_config (key, value) VALUES (?, ?)'
    );
    for (const [k, v] of configs) {
      insert.run(k, v);
    }
  }

  seedManagers() {
    const countRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM managers')
      .get() as { cnt: number };
    if (countRow.cnt === 0) {
      const insert = this.db.prepare(
        'INSERT INTO managers (id, name, is_owner) VALUES (?, ?, ?)'
      );
      for (let i = 1; i <= LEAGUE_RULES.managerCount; i++) {
        insert.run(i, '', i === 1 ? 1 : 0);
      }
    }
  }

  prepare(sql: string): DbStatement {
    const stmt = this.db.prepare(sql);
    return {
      all: (...params: any[]) => stmt.all(...params),
      get: (...params: any[]) => stmt.get(...params) ?? undefined,
      run: (...params: any[]) => {
        const r = stmt.run(...params);
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}
