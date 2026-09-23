// GET /api/giocatori — Lista completa di tutti i giocatori dal listone,
// con flag obiettivo, stato asta, e statistiche essenziali.

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-factory';
import { getDataset } from '@/lib/agent-tools';
import { replayEffective, loadManagerNames } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHEET_ID = '1EevP487Edm426NbEi_W1N4mm3-nqpZ8zB3-jodA2Ez8';
const ROLES_S: Array<'P' | 'D' | 'C' | 'A'> = ['P', 'D', 'C', 'A'];

function norm(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[''`´]/g, "'").toLowerCase()
    .replace(/\s+/g, ' ').trim();
}

function parseCsvFirstColumn(csv: string): string[] {
  return csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && l !== ',')
    .map((l) => l.split(',')[0].trim().replace(/^"|"$/g, '').trim())
    .filter((s) => s.length > 0);
}

async function fetchSheet(role: 'P' | 'D' | 'C' | 'A'): Promise<string[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${role}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    return parseCsvFirstColumn(await res.text());
  } catch { return []; }
}

function splitNameAndTeam(raw: string): { nome: string; team: string | null } {
  const m = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { nome: m[1].trim(), team: m[2].trim() };
  return { nome: raw.trim(), team: null };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');
    const q = (searchParams.get('q') || '').toLowerCase().trim();

    const ds = getDataset();
    const db = await getDb();
    const managerNames = await loadManagerNames(db);
    const snap = await replayEffective(db, ds, managerNames);

    let players = ds.players.map((p: any) => {
      const sid = String(p.id);
      const status = snap.playerStatus[sid] ?? 'free';
      const ownerId = snap.playerOwner[sid];
      const ownerName = ownerId != null
        ? snap.managers.find((m) => m.id === ownerId)?.name ?? null
        : null;
      return {
        id: p.id,
        nome: p.nome,
        squadra: p.squadra,
        ruolo: p.ruolo,
        quotAttuale: p.quotAttuale ?? null,
        quotIniziale: p.quotIniziale ?? null,
        diff: p.diff ?? null,
        fvm: p.fvm ?? null,
        fascia: p.fascia ?? null,
        prezzoGuida: p.prezzoGuida ?? null,
        titolarita: p.titolarita ?? null,
        pupillo: !!p.pupillo,
        valorizzato: !!p.valorizzato,
        penalizzato: !!p.penalizzato,
        ballottaggio: !!p.ballottaggio,
        giovane: !!p.giovane,
        status,
        ownerName,
      };
    });

    // Merge obiettivi (best-effort)
    try {
      const sheetResults = await Promise.all(ROLES_S.map((r) => fetchSheet(r)));
      const [pRows, dRows, cRows, aRows] = sheetResults;
      const obiettivoSet = new Set<number>();
      const processSheet = (rows: string[], ruolo: string) => {
        for (const raw of rows) {
          if (/^(piano|reparto|portieri?|difensori?|centrocampisti?|attaccanti?)/i.test(raw)) continue;
          if (raw.length < 3) continue;
          const { nome, team } = splitNameAndTeam(raw);
          const nn = norm(nome);
          const match = players.find((p: any) => {
            if (p.ruolo !== ruolo) return false;
            if (norm(p.nome) !== nn) return false;
            if (team && norm(p.squadra) !== norm(team)) return false;
            return true;
          });
          if (match) obiettivoSet.add(match.id);
        }
      };
      processSheet(pRows, 'P'); processSheet(dRows, 'D');
      processSheet(cRows, 'C'); processSheet(aRows, 'A');
      players = players.map((p: any) => ({ ...p, obiettivo: obiettivoSet.has(p.id) }));
    } catch { /* sheet non raggiungibile */ }

    if (role && ['P','D','C','A'].includes(role)) {
      players = players.filter((p: any) => p.ruolo === role);
    }
    if (q) {
      players = players.filter((p: any) =>
        `${p.nome} ${p.squadra}`.toLowerCase().includes(q)
      );
    }

    return NextResponse.json({ ok: true, count: players.length, players });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
