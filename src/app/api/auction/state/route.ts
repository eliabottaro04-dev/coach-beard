// GET /api/auction/state — stato completo dell'asta
import { NextResponse } from 'next/server';
import { getAuctionState } from '@/lib/auction-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snap = await getAuctionState();
    return NextResponse.json({
      ok: true,
      state: snap.state,
      phase: snap.phase,
      stateVersion: snap.stateVersion,
      startedAt: snap.startedAt,
      completedAt: snap.completedAt,
      managers: snap.managers.map((m) => ({
        id: m.id,
        name: m.name,
        isOwner: m.isOwner,
        credits: m.credits,
        spent: m.spent,
        byRole: m.byRole,
        playerCount: m.players.length,
      })),
      playerStatus: snap.playerStatus,
      eventCount: snap.events.length,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
