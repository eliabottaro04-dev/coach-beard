// Adapter Postgres per Coach Beard.
// Usa pg.Pool e espone la stessa interfaccia di db-sqlite.ts per il factory pattern.

import { Pool, PoolClient } from 'pg';
import { LEAGUE_RULES } from './league-rules';

export type DbRunResult = {
  changes: number;
  lastInsertRowid: string | number;
};

export interface DbStatement {
  all(...params: any[]): Promise<any[]>;
  get(...params: any[]): Promise<any | undefined>;
  run(...params: any[]): Promise<DbRunResult>;
}

export interface DbInterface {
  prepare(sql: string): DbStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: TxInterface) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface TxInterface {
  prepare(sql: string): DbStatement;
  exec(sql: string): Promise<void>;
}

// ─── PostgresDb ────────────────────────────────────────────────────────────

export class PostgresDb implements DbInterface {
  private pool: Pool;
  private _closed = false;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      // Neon/Vercel Postgres: connection string già include sslmode
      max: 1, // serverless: una connessione per richiesta è sufficiente
    });
  }

  async init(): Promise<this> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS managers (
        id        BIGINT PRIMARY KEY,
        name      TEXT    NOT NULL DEFAULT '',
        is_owner  BIGINT  NOT NULL DEFAULT 0
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS league_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS auction_events (
        sequence_id      BIGSERIAL PRIMARY KEY,
        type             TEXT NOT NULL,
        ts               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        idempotency_key  TEXT,
        payload_json     TEXT NOT NULL,
        compensated_seq  BIGINT
          REFERENCES auction_events(sequence_id) ON DELETE SET NULL
      )
    `);

    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_events_type ON auction_events(type)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_events_comp ON auction_events(compensated_seq)`);

    // Partial unique index per idempotency (Postgres supporta WHERE)
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_idem
        ON auction_events(idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `).catch(() => { /* ignore "already exists" */ });

    await this.initConfig();
    await this.seedManagers();
    return this;
  }

  async initConfig() {
    const configs = [
      ['league_name', LEAGUE_RULES.leagueName],
      ['initial_credits', String(LEAGUE_RULES.initialCredits)],
      ['roster_P', String(LEAGUE_RULES.roster.P)],
      ['roster_D', String(LEAGUE_RULES.roster.D)],
      ['roster_C', String(LEAGUE_RULES.roster.C)],
      ['roster_A', String(LEAGUE_RULES.roster.A)],
      ['manager_count', String(LEAGUE_RULES.managerCount)],
    ];
    for (const [k, v] of configs) {
      await this.pool.query(
        `INSERT INTO league_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [k, v]
      );
    }
  }

  async seedManagers() {
    const result = await this.pool.query('SELECT COUNT(*) as cnt FROM managers');
    if (parseInt(result.rows[0].cnt) === 0) {
      for (let i = 1; i <= LEAGUE_RULES.managerCount; i++) {
        await this.pool.query(
          `INSERT INTO managers (id, name, is_owner) VALUES ($1, $2, $3)`,
          [i, '', i === 1 ? 1 : 0]
        );
      }
    }
  }

  prepare(sql: string): DbStatement {
    const pool = this.pool;
    return {
      all: async (...params: any[]) => {
        const r = await pool.query(sql, params);
        return r.rows;
      },
      get: async (...params: any[]) => {
        const r = await pool.query(sql, params);
        return r.rows[0] ?? undefined;
      },
      run: async (...params: any[]) => {
        const r = await pool.query(sql, params);
        // L'adapter nasconde la differenza: Postgres usa RETURNING sequence_id
        // se il chiamante ha scritto la query con RETURNING
        return {
          changes: r.rowCount ?? 0,
          lastInsertRowid: r.rows[0]?.sequence_id ?? r.rows[0]?.id ?? 0,
        };
      },
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: TxInterface) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx: TxInterface = {
        prepare: (sql: string) => ({
          all: async (...params: any[]) => {
            const r = await client.query(sql, params);
            return r.rows;
          },
          get: async (...params: any[]) => {
            const r = await client.query(sql, params);
            return r.rows[0] ?? undefined;
          },
          run: async (...params: any[]) => {
            const r = await client.query(sql, params);
            return {
              changes: r.rowCount ?? 0,
              lastInsertRowid: r.rows[0]?.sequence_id ?? r.rows[0]?.id ?? 0,
            };
          },
        }),
        exec: async (sql: string) => {
          await client.query(sql);
        },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (!this._closed) {
      this._closed = true;
      await this.pool.end();
    }
  }
}
