// GET /api/giocatori/detail?id=ID — Profilo completo di un giocatore con
// statistiche, stato asta, prezzi guida e tetto massimo per il manager proprietario.

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db-factory';
import { getDataset } from '@/lib/agent-tools';
import { replayEffective, loadManagerNames } from '@/lib/events';
import { LEAGUE_RULES, ROSTER_SIZE } from '@/lib/league-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const idStr = url.searchParams.get('id');
    const playerId = parseInt(idStr ?? '', 10);
    if (isNaN(playerId)) return NextResponse.json({ ok: false, error: 'ID non valido' }, { status: 400 });

    const ds = getDataset();
    const p = ds.players.find((x: any) => x.id === playerId);
    if (!p) return NextResponse.json({ ok: false, error: 'Giocatore non trovato' }, { status: 404 });

    const db = await getDb();
    const managerNames = await loadManagerNames(db);
    const snap = await replayEffective(db, ds, managerNames);
    const owner = snap.managers.find((m) => m.isOwner);

    const sid = String(playerId);
    const status = snap.playerStatus[sid] ?? 'free';
    const ownerId = snap.playerOwner[sid];
    const ownerName = ownerId != null
      ? snap.managers.find((m) => m.id === ownerId)?.name ?? null
      : null;

    let bidCeiling: number | null = null;
    let ownerCredits: number | null = null;
    let ownerEmptySlots: number | null = null;
    if (owner) {
      ownerCredits = owner.credits;
      ownerEmptySlots = ROSTER_SIZE - owner.players.length;
      bidCeiling = Math.max(0, ownerCredits - ownerEmptySlots);
    }

    const rosa = LEAGUE_RULES.roster;
    const slotsFree = {
      P: Math.max(0, rosa.P - (owner?.byRole.P ?? 0)),
      D: Math.max(0, rosa.D - (owner?.byRole.D ?? 0)),
      C: Math.max(0, rosa.C - (owner?.byRole.C ?? 0)),
      A: Math.max(0, rosa.A - (owner?.byRole.A ?? 0)),
    };

    return NextResponse.json({
      ok: true,
      player: {
        id: p.id,
        nome: p.nome,
        ruolo: p.ruolo,
        ruoloMantra: p.ruoloMantra ?? null,
        squadra: p.squadra,
        quotAttuale: p.quotAttuale ?? null,
        quotIniziale: p.quotIniziale ?? null,
        diff: p.diff ?? null,
        fvm: p.fvm ?? null,
        fascia: p.fascia ?? null,
        prezzoGuida: p.prezzoGuida ?? null,
        budgetPct: p.budgetPct ?? null,
        pmaPct: p.pmaPct ?? null,
        titolarita: p.titolarita ?? null,
        mv: p.mv ?? null,
        titolareXI: p.titolareXI ?? null,
        ballottaggio: !!p.ballottaggio,
        valorizzato: !!p.valorizzato,
        penalizzato: !!p.penalizzato,
        giovane: !!p.giovane,
        nomeNascosto: !!p.nomeNascosto,
        rigorista: !!p.rigorista,
        punizioni: !!p.punizioni,
        corner: !!p.corner,
        noteGuida: p.noteGuida ?? null,
        pupillo: !!p.pupillo,
        sources: {
          quotazioneAttuale: { value: p.quotAttuale, source: 'Listone 2026-27' },
          quotazioneIniziale: { value: p.quotIniziale, source: 'Listone 2026-27' },
          fvm: { value: p.fvm, source: 'FantaMediaVoto storico' },
          prezzoGuida: { value: p.prezzoGuida, source: 'Strategia personale' },
          budgetPct: { value: p.budgetPct, source: 'Strategia personale' },
          titolarita: { value: p.titolarita, source: 'Guida oggettiva' },
          fascia: { value: p.fascia, source: 'Strategia personale' },
          note: { value: p.noteGuida, source: 'Guida oggettiva' },
          ballottaggio: { value: p.ballottaggio, source: 'Guida oggettiva' },
          valorizzato: { value: p.valorizzato, source: 'Guida oggettiva' },
          penalizzato: { value: p.penalizzato, source: 'Guida oggettiva' },
        },
      },
      auction: {
        status,
        ownerName,
        ownerCredits,
        ownerEmptySlots,
        bidCeiling,
        slotRuoloPieno: p.ruolo ? ((owner?.byRole[p.ruolo] ?? 0) >= rosa[p.ruolo]) : false,
        slotsFree,
        formula: ownerCredits != null && ownerEmptySlots != null
          ? `${ownerCredits} - ${ownerEmptySlots} = ${bidCeiling}`
          : null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
