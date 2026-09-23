// POST /api/auction/phase — cambia reparto
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/auction-api';
import { changePhase } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phase, idempotencyKey } = body ?? {};
    const valid = ['P', 'D', 'C', 'A'];

    if (!valid.includes(phase)) {
      return NextResponse.json({ ok: false, error: `phase deve essere uno tra ${valid.join(', ')}` }, { status: 400 });
    }

    const db = await getDb();
    const { event } = await changePhase(db, phase, idempotencyKey);
    return NextResponse.json({ ok: true, event });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
