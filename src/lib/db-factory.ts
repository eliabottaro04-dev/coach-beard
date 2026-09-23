// Factory DB: sceglie Postgres o SQLite in base a DATABASE_URL.
// Uso: import { getDb } from '@/lib/db-factory';

import type { DbInterface } from './db-sqlite';

let _db: DbInterface | null = null;
let _dbType: 'sqlite' | 'postgres' = 'sqlite';
let _initPromise: Promise<DbInterface> | null = null;

export type { DbRunResult, DbStatement } from './db-sqlite';
export type { DbInterface } from './db-sqlite';

export async function getDb(): Promise<DbInterface> {
  if (_db) return _db;

  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    if (process.env.DATABASE_URL) {
      // Postgres: import dinamico per non bundlare pg in locale senza bisogno
      const { PostgresDb } = await import('./db-postgres');
      _db = await new PostgresDb(process.env.DATABASE_URL).init();
      _dbType = 'postgres';
    } else {
      // SQLite locale: import statico (già in dependencies)
      const { SqliteDb } = await import('./db-sqlite');
      _db = new SqliteDb('./coach-beard.db').init();
      _dbType = 'sqlite';
    }
    return _db;
  })();

  return _initPromise;
}

export function getDbType(): 'sqlite' | 'postgres' {
  return _dbType;
}

// Per retrocompatibilità durante la transizione: export sincrono lazy
// che funziona solo in locale (senza DATABASE_URL). Le API routes DEVONO
// usare await getDb() — questo export è deprecato e sarà rimosso.
export function getDbSync(): DbInterface {
  if (_db) return _db;
  // Lettura sincrona: solo se già inizializzato (locale SQLite)
  if (!_initPromise) {
    const { SqliteDb } = require('./db-sqlite');
    _db = new SqliteDb('./coach-beard.db').init();
    _dbType = 'sqlite';
    return _db;
  }
  // Se c'è una Promise pendente, significa che l'init è async
  // (Postgres). In questo caso il codice DEVE usare await getDb().
  throw new Error(
    'Database non inizializzato in modo sincrono. Usa: const db = await getDb()'
  );
}
