// Endpoint per ispezionare il dataset costruito nella Fase 1
// Ritorna anche i giocatori in forma leggera per l'asta live (ricerca/combo).

import { NextResponse } from 'next/server';
import { loadDataset } from '@/lib/dataset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ds = loadDataset();

    // Forma leggera: solo i campi che servono al client dell'asta
    const players = (ds.players || []).map((p: any) => ({
      id: p.id,
      nome: p.nome,
      squadra: p.squadra,
      ruolo: p.ruolo,
      quotAttuale: p.quotAttuale ?? null,
      prezzoGuida: p.prezzoGuida ?? null,
      fascia: p.fascia ?? null,
      pupillo: !!p.pupillo,
    }));

    return NextResponse.json({
      ok: true,
      version: ds.version,
      generatedAt: ds.generatedAt,
      stats: ds.stats,
      teams: ds.teams,
      players,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
