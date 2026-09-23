import { NextResponse } from 'next/server';
import { getDb, getDbType } from '@/lib/db-factory';
import { loadManagerNames } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDb();
    const managerNames = await loadManagerNames(db);
    return NextResponse.json({
      ok: true,
      dbType: getDbType(),
      dbReady: true,
      managers: Object.keys(managerNames).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
