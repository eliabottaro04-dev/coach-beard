import { NextResponse } from 'next/server';
import { getDb, getDbType } from '@/lib/db-factory';
import { loadManagerNames } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readConfig(db: any): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT key, value FROM league_config').all();
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;
  return cfg;
}

export async function GET() {
  try {
    const db = await getDb();
    const managerNames = await loadManagerNames(db);
    const config = await readConfig(db);
    return NextResponse.json({
      ok: true,
      dbType: getDbType(),
      dbReady: true,
      managers: Object.keys(managerNames).length,
      config,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
