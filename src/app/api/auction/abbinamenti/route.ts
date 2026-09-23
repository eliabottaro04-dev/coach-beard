// GET /api/auction/abbinamenti — Legge gli abbinamenti dalla strategia
// e li arricchisce con i giocatori disponibili dal dataset.

import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '@/lib/db-factory';
import { getDataset } from '@/lib/agent-tools';
import { replayEffective, loadManagerNames } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Abbinamento = {
  teams: string[];
  combo: string;
  rating: number | null;
  info: string | null;
  players: Array<{
    id: number;
    nome: string;
    ruolo: string;
    squadra: string;
    quotAttuale: number | null;
    status: 'free' | 'sold' | 'unsold';
    ownerName: string | null;
  }>;
};

function norm(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[''`´]/g, "'").toLowerCase()
    .replace(/\s+/g, ' ').trim();
}

export async function GET() {
  try {
    const abbinPath = join(process.cwd(), 'data', 'abbinamenti.json');
    if (!existsSync(abbinPath)) {
      return NextResponse.json({ ok: false, error: 'abbinamenti.json non trovato. Esegui npm run build:abbinamenti.' }, { status: 404 });
    }
    const abbin = JSON.parse(readFileSync(abbinPath, 'utf-8'));
    const ds = getDataset();
    const db = await getDb();
    const managerNames = await loadManagerNames(db);
    const snap = await replayEffective(db, ds, managerNames);

    // Costruisci mappa: nome normalizzato → giocatori di quella squadra
    const teamMap = new Map<string, any[]>();
    for (const p of ds.players) {
      const key = norm(p.squadra);
      if (!teamMap.has(key)) teamMap.set(key, []);
      teamMap.get(key)!.push(p);
    }

    // Risultato per ruolo
    const result: Record<string, { header: string | null; combos: Abbinamento[] }> = {};

    for (const [role, data] of Object.entries(abbin.byRole) as [string, any][]) {
      const combos: Abbinamento[] = [];
      for (const combo of data.combos) {
        // Raccogli giocatori da ogni squadra dell'abbinamento, SOLO del ruolo corrente
        const allPlayers: Abbinamento['players'] = [];
        for (const teamName of combo.teams) {
          const key = norm(teamName);
          const players = (teamMap.get(key) ?? []).filter((p: any) => p.ruolo === role);
          for (const p of players) {
            const sid = String(p.id);
            const status = snap.playerStatus[sid] ?? 'free';
            const ownerId = snap.playerOwner[sid];
            const ownerName = ownerId != null
              ? snap.managers.find((m) => m.id === ownerId)?.name ?? null
              : null;
            allPlayers.push({
              id: p.id,
              nome: p.nome,
              ruolo: p.ruolo,
              squadra: p.squadra,
              quotAttuale: p.quotAttuale ?? null,
              status,
              ownerName,
            });
          }
        }

        combos.push({
          ...combo,
          players: allPlayers,
        });
      }
      result[role] = { header: data.header ?? null, combos };
    }

    return NextResponse.json({ ok: true, generatedAt: abbin.generatedAt, byRole: result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
