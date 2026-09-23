// POST /api/auction/unsold — dichiara un giocatore invenduto
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/auction-api';
import { markUnsoldSafe } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { playerId, idempotencyKey } = body ?? {};

    if (typeof playerId !== 'number') {
      return NextResponse.json({ ok: false, error: 'playerId deve essere un numero' }, { status: 400 });
    }

    const db = await getDb();
    const { event } = await markUnsoldSafe(db, playerId, idempotencyKey);
    return NextResponse.json({ ok: true, event });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
