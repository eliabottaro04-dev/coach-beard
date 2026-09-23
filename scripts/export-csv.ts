#!/usr/bin/env node
// Esporta l'asta simulata in CSV Leghe Fantacalcio.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SqliteDb } from '../src/lib/db-sqlite';
import { replayEffective } from '../src/lib/events';
import { validateLegheExport, generateLegheFantacalcioCsv, buildLegheExportFilename } from '../src/lib/export-leghe';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = join(ROOT, 'data', 'sim-auction.db');
const DATASET_PATH = join(ROOT, 'data', 'dataset.json');

const db = new SqliteDb(DB_PATH).init();
const ds = JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));

async function main() {
  const snap = await replayEffective(db, ds);

  const dbNames = db.prepare('SELECT id, name FROM managers ORDER BY id').all() as Array<{id:number;name:string}>;
  const REAL_MANAGER_COUNT = 8;

  const snapById = new Map<number, any>(snap.managers.map((m: any) => [m.id, m]));

  const teams = dbNames.map((dbMgr) => {
    const isPlaceholder = dbMgr.id > REAL_MANAGER_COUNT;
    const snapMgr = snapById.get(dbMgr.id);
    const players = (snapMgr?.players ?? []).map((p: any) => ({
      officialPlayerId: p.playerId,
      playerName: p.name,
      role: p.ruolo as 'P' | 'D' | 'C' | 'A',
      purchasePrice: p.prezzo,
      status: 'purchased' as const,
    }));
    return {
      teamId: `team-${dbMgr.id}`,
      displayOrder: dbMgr.id,
      name: dbMgr.name || `Manager ${dbMgr.id}`,
      teamType: isPlaceholder ? ('placeholder' as const) : ('real' as const),
      players,
    };
  });

  const input = {
    schemaVersion: '1.0.0',
    league: {
      name: 'Fanta27',
      initialCredits: 500,
      datasetVersion: 'v0.1.0-2026-09-02',
      rosterRules: { P: 3, D: 8, C: 8, A: 6 },
    },
    teams,
  };

  const validation = validateLegheExport(input);
  const csv = generateLegheFantacalcioCsv(input);
  const filename = buildLegheExportFilename(input.league.name, new Date());

  console.log(csv);
  console.log(`# File: ${filename}`);
  console.log(`# Validation errors: ${(validation as any).errors?.length ?? 0}`);

  db.close();
}

main().catch((err) => { console.error('❌ Errore:', err); process.exit(1); });
