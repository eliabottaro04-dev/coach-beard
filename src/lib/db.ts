// Re-export shim per retrocompatibilità.
// Il vero entry point è db-factory.ts (gestisce SQLite/Postgres dual-mode).
//
// Le API routes e i tool devono usare direttamente db-factory per
// l'inizializzazione async. Questo file resta solo per i casi
// (es. telegram-bot) che aprono il DB localmente con better-sqlite3.

export { getDb, getDbType, getDbSync } from './db-factory';
export type { DbInterface, DbRunResult, DbStatement } from './db-factory';
