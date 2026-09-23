// POST /api/auction/purchase — registra un acquisto
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getDatasetSync } from '@/lib/auction-api';
import { recordPurchaseSafe } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { playerId, managerId, price, idempotencyKey } = body ?? {};

    if (typeof playerId !== 'number' || typeof managerId !== 'number' || typeof price !== 'number') {
      return NextResponse.json({ ok: false, error: 'playerId, managerId e price devono essere numeri' }, { status: 400 });
    }

    const db = await getDb();
    const ds = getDatasetSync();
    const result = await recordPurchaseSafe(db, ds, { playerId, managerId, price, idempotencyKey });

    if (!result.ok) {
      return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 });
    }

    return NextResponse.json({ ok: true, event: result.event, duplicate: result.duplicate });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
