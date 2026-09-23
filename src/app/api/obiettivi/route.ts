// GET /api/obiettivi — Legge i 4 fogli Google (P/D/C/A) e ritorna per ogni
// obiettivo: nome risolto, stato nell'asta (LIBERO/MIO/SOFFIATO), info utili.

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-factory';
import { getDataset } from '@/lib/agent-tools';
import { replayEffective, loadManagerNames } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHEET_ID = '1EevP487Edm426NbEi_W1N4mm3-nqpZ8zB3-jodA2Ez8';
const ROLES: Array<'P' | 'D' | 'C' | 'A'> = ['P', 'D', 'C', 'A'];

function parseCsvFirstColumn(csv: string): string[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== ',')
    .map((line) => {
      const firstCol = line.split(',')[0].trim();
      return firstCol.replace(/^"|"$/g, '').trim();
    })
    .filter((s) => s.length > 0);
}

function splitNameAndTeam(raw: string): { nome: string; squadra: string | null } {
  const m = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { nome: m[1].trim(), squadra: m[2].trim() };
  return { nome: raw.trim(), squadra: null };
}

function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchSheet(role: 'P' | 'D' | 'C' | 'A'): Promise<string[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${role}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.error(`[obiettivi] Foglio ${role}: HTTP ${res.status}`);
      return [];
    }
    const text = await res.text();
    return parseCsvFirstColumn(text);
  } catch (err: any) {
    console.error(`[obiettivi] Foglio ${role} errore:`, err.message);
    return [];
  }
}

type Player = { id: number; nome: string; squadra: string; ruolo: string; quotAttuale: number | null; prezzoGuida: number | null; fascia: string | null; pupillo?: boolean };

function resolveAgainstDataset(
  nome: string,
  squadra: string | null,
  ruolo: 'P' | 'D' | 'C' | 'A',
  players: Player[],
): Player | null {
  const nn = norm(nome);

  let candidates = players.filter((p) => {
    if (p.ruolo !== ruolo) return false;
    if (norm(p.nome) !== nn) return false;
    if (squadra && norm(p.squadra) !== norm(squadra)) return false;
    return true;
  });
  if (candidates.length === 1) return candidates[0];

  if (candidates.length === 0 && squadra) {
    candidates = players.filter((p) => {
      if (p.ruolo !== ruolo) return false;
      return norm(p.nome) === nn;
    });
    if (candidates.length === 1) return candidates[0];
  }

  const cognome = nn.split(' ')[0].replace(/[.,]/g, '');
  if (cognome.length >= 4) {
    const fuzzy = players.filter((p) => {
      if (p.ruolo !== ruolo) return false;
      const pc = norm(p.nome).split(' ')[0].replace(/[.,]/g, '');
      return pc === cognome;
    });
    if (fuzzy.length === 1) return fuzzy[0];
  }

  return null;
}

export async function GET() {
  try {
    console.log('[obiettivi] START');
    const sheetsResults = await Promise.all(ROLES.map((r) => fetchSheet(r)));
    const [pRows, dRows, cRows, aRows] = sheetsResults;
    console.log('[obiettivi] fetched:', { P: pRows.length, D: dRows.length, C: cRows.length, A: aRows.length });

    const ds = getDataset();
    const players: Player[] = (ds.players || []).map((p: any) => ({
      id: p.id,
      nome: p.nome,
      squadra: p.squadra,
      ruolo: p.ruolo,
      quotAttuale: p.quotAttuale,
      prezzoGuida: p.prezzoGuida,
      fascia: p.fascia,
      pupillo: p.pupillo,
    }));

    const db = await getDb();
    const managerNames = await loadManagerNames(db);
    const snap = await replayEffective(db, ds, managerNames);
    const ownerMgr = snap.managers.find((m) => m.isOwner);

    type Obiettivo = {
      raw: string;
      nome: string;
      squadra: string | null;
      ruolo: 'P' | 'D' | 'C' | 'A';
      playerId: number | null;
      status: 'free' | 'mine' | 'taken' | 'unresolved';
      owner: string | null;
      quotAttuale: number | null;
      prezzoGuida: number | null;
      fascia: string | null;
      pupillo: boolean;
    };

    const obiettivi: Obiettivo[] = [];
    const counts = { P: 0, D: 0, C: 0, A: 0 };

    const processRole = (rows: string[], ruolo: 'P' | 'D' | 'C' | 'A') => {
      for (const raw of rows) {
        if (/^(piano|reparto|portieri?|difensori?|centrocampisti?|attaccanti?)/i.test(raw)) continue;
        if (raw.length < 3) continue;

        const { nome, squadra } = splitNameAndTeam(raw);
        const player = resolveAgainstDataset(nome, squadra, ruolo, players);

        let status: Obiettivo['status'];
        let ownerName: string | null = null;

        if (!player) {
          status = 'unresolved';
        } else {
          const statusKey = String(player.id);
          const playerStatus = snap.playerStatus[statusKey];
          const playerOwnerId = snap.playerOwner[statusKey];

          if (playerStatus === 'sold' && playerOwnerId != null) {
            if (ownerMgr && playerOwnerId === ownerMgr.id) {
              status = 'mine';
              ownerName = ownerMgr.name;
            } else {
              status = 'taken';
              const o = snap.managers.find((m) => m.id === playerOwnerId);
              ownerName = o?.name ?? '?';
            }
          } else {
            status = 'free';
          }
        }

        obiettivi.push({
          raw,
          nome: player?.nome ?? nome,
          squadra: player?.squadra ?? squadra,
          ruolo,
          playerId: player?.id ?? null,
          status,
          owner: ownerName,
          quotAttuale: player?.quotAttuale ?? null,
          prezzoGuida: player?.prezzoGuida ?? null,
          fascia: player?.fascia ?? null,
          pupillo: !!player?.pupillo,
        });

        counts[ruolo]++;
      }
    };

    processRole(pRows, 'P');
    processRole(dRows, 'D');
    processRole(cRows, 'C');
    processRole(aRows, 'A');

    const summary = {
      total: obiettivi.length,
      free: obiettivi.filter((o) => o.status === 'free').length,
      mine: obiettivi.filter((o) => o.status === 'mine').length,
      taken: obiettivi.filter((o) => o.status === 'taken').length,
      unresolved: obiettivi.filter((o) => o.status === 'unresolved').length,
    };

    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      sheetId: SHEET_ID,
      obiettivi,
      byRole: counts,
      summary,
    });
  } catch (err: any) {
    console.error('[api/obiettivi] CATCH:', err?.message ?? err, err?.stack);
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
