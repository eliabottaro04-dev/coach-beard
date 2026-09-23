// GET /api/auction/export — esporta CSV Leghe Fantacalcio
import { NextResponse } from 'next/server';
import { getDb, getDatasetSync } from '@/lib/auction-api';
import { replayEffective, loadManagerNames } from '@/lib/events';
import { validateLegheExport, generateLegheFantacalcioCsv, buildLegheExportFilename } from '@/lib/export-leghe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();
    const ds = getDatasetSync();
    const managerNames = await loadManagerNames(db);
    const snap = await replayEffective(db, ds, managerNames);

    const REAL_MANAGER_COUNT = 8;
    const dbNames = await db.prepare('SELECT id, name FROM managers ORDER BY id').all() as Array<{id: number; name: string}>;
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

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Validation-Warnings': validation.valid ? '0' : String(validation.errors.length),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
