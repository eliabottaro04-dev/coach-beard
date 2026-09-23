// API: POST /api/agent
// Body: { message: string, managerId?: number, managerName?: string }

import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent';
import { getDb } from '@/lib/db-factory';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getDatasetLocal() {
  const path = join(process.cwd(), 'data', 'dataset.json');
  if (!existsSync(path)) {
    throw new Error('dataset.json non trovato. Esegui npm run build:dataset.');
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, managerId, managerName } = body ?? {};
    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: 'message mancante o non valido' },
        { status: 400 }
      );
    }

    try { getDatasetLocal(); }
    catch (err: any) {
      return NextResponse.json(
        { error: err.message, hint: 'npm run build:dataset' },
        { status: 503 }
      );
    }

    const db = await getDb();
    const response = await runAgent(db, message, { managerId, managerName });

    return NextResponse.json({
      ...response,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[api/agent]', err);
    return NextResponse.json(
      { error: err.message ?? 'Errore interno' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const { getAgentConfig } = await import('@/lib/agent-config');
  const config = getAgentConfig();
  return NextResponse.json({
    provider: config.provider,
    model: config.model,
    hasApiKey: config.hasApiKey,
    datasetVersion: config.datasetVersion,
    mode: config.hasApiKey ? 'ai' : 'deterministic',
  });
}
