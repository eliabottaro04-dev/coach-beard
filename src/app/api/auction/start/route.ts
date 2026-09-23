// POST /api/auction/start — avvia l'asta
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getDatasetSync } from '@/lib/auction-api';
import { startAuction, replayEffective, loadManagerNames } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const db = await getDb();
    const ds = getDatasetSync();
    const managerNames = await loadManagerNames(db);
    const snap = await replayEffective(db, ds, managerNames);

    if (snap.state !== 'DRAFT' && snap.state !== 'PAUSED') {
      return NextResponse.json({
        ok: false,
        error: `Asta già in stato ${snap.state}. Solo DRAFT o PAUSED possono partire.`,
      }, { status: 409 });
    }

    const { event } = await startAuction(db);
    return NextResponse.json({ ok: true, event });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
