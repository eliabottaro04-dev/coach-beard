import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Cerca calciatori per nome/squadra (case insensitive)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    const role = url.searchParams.get('role') || null;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);

    if (!q) return NextResponse.json({ ok: true, results: [] });

    const path = join(process.cwd(), 'data', 'dataset.json');
    if (!existsSync(path)) {
      return NextResponse.json({ ok: false, error: 'dataset.json non trovato' }, { status: 404 });
    }
    const ds = JSON.parse(readFileSync(path, 'utf-8'));
    let results = ds.players.filter((p: any) => {
      const blob = `${p.nome} ${p.squadra}`.toLowerCase();
      return blob.includes(q);
    });
    if (role) results = results.filter((p: any) => p.ruolo === role);
    results = results.slice(0, limit);
    return NextResponse.json({ ok: true, count: results.length, results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
