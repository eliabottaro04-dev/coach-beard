// POST /api/setup — scrive i nomi dei manager nel DB
// GET /api/setup — legge la configurazione attuale

import { NextRequest, NextResponse } from 'next/server';
import { getDb, getDbType } from '@/lib/db-factory';
import { loadManagerNames } from '@/lib/events';
import { LEAGUE_RULES } from '@/lib/league-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readConfig(db: any): Promise<Record<string, string>> {
  // league_config è key/value
  const rows = await db.prepare('SELECT key, value FROM league_config').all();
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;
  return cfg;
}

async function readManagers(db: any) {
  const rows = await db.prepare('SELECT id, name, is_owner as isOwner FROM managers ORDER BY id').all();
  return rows.map((r: any) => ({
    id: Number(r.id),
    name: r.name ?? '',
    isOwner: r.isOwner === 1 || r.isOwner === '1',
  }));
}

export async function GET() {
  try {
    const db = await getDb();
    const config = await readConfig(db);
    const managers = await readManagers(db);
    return NextResponse.json({
      ok: true,
      dbType: getDbType(),
      config,
      managers,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { managers, reset } = body ?? {};

    if (reset === true) {
      const db = await getDb();
      // Reset managers (delete + reinsert vuoti)
      await db.prepare('DELETE FROM managers').run();
      for (let i = 1; i <= LEAGUE_RULES.managerCount; i++) {
        await db.prepare(
          'INSERT INTO managers (id, name, is_owner) VALUES (?, ?, ?)'
        ).run(i, '', i === 1 ? 1 : 0);
      }
      return NextResponse.json({ ok: true, action: 'reset' });
    }

    if (!Array.isArray(managers)) {
      return NextResponse.json({ ok: false, error: 'managers deve essere un array' }, { status: 400 });
    }

    if (managers.length !== LEAGUE_RULES.managerCount) {
      return NextResponse.json({
        ok: false,
        error: `Servono ${LEAGUE_RULES.managerCount} manager, ne hai passati ${managers.length}`,
      }, { status: 400 });
    }

    for (const m of managers) {
      if (!m.name || typeof m.name !== 'string' || m.name.trim() === '') {
        return NextResponse.json({ ok: false, error: `Manager #${m.id} senza nome` }, { status: 400 });
      }
    }

    const owners = managers.filter((m: any) => m.isOwner);
    if (owners.length !== 1) {
      return NextResponse.json({ ok: false, error: 'Devi scegliere esattamente un proprietario' }, { status: 400 });
    }

    const names = new Set(managers.map((m: any) => m.name.trim().toLowerCase()));
    if (names.size !== managers.length) {
      return NextResponse.json({ ok: false, error: 'I nomi dei manager devono essere unici' }, { status: 400 });
    }

    const db = await getDb();
    const update = db.prepare('UPDATE managers SET name = ?, is_owner = ? WHERE id = ?');
    // Transazione cross-driver: SQLite è sync, Postgres è async
    if (getDbType() === 'postgres') {
      // Postgres path: usiamo la transaction async del nostro adapter
      await (db as any).transaction(async (tx: any) => {
        for (const m of managers) {
          await tx.prepare('UPDATE managers SET name = ?, is_owner = ? WHERE id = ?')
            .run(m.name.trim(), m.isOwner ? 1 : 0, m.id);
        }
      });
    } else {
      // SQLite path: transazione sync
      (db as any).transaction(() => {
        for (const m of managers) {
          update.run(m.name.trim(), m.isOwner ? 1 : 0, m.id);
        }
      })();
    }

    const finalManagers = await readManagers(db);
    return NextResponse.json({ ok: true, managers: finalManagers });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
