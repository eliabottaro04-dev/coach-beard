// POST /api/auction/undo — annulla l'ultimo acquisto/invenduto
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/auction-api';
import { undoLast } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { idempotencyKey } = body ?? {};
    const db = await getDb();
    const result = await undoLast(db, idempotencyKey);

    if (!result.ok) {
      return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 });
    }

    return NextResponse.json({ ok: true, undone: result.undone, compensate: result.compensate });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
