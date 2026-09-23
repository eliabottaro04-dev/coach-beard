// Registro event-sourced per l'asta.
// Regole d'oro:
//  1) Append-only: nessun DELETE / UPDATE sulla tabella events.
//  2) L'undo è un nuovo evento COMPENSATE che referenzia l'evento originale.
//  3) Idempotency: ogni operazione di scrittura accetta una idempotencyKey;
//     se la chiave è già stata processata, ritorniamo l'esito della prima
//     esecuzione (nessun doppio acquisto).
//  4) Lo stato corrente è sempre derivato dal replay dell'event log.
//
// NOTA SULL'ASINCronicità:
//   Tutte le funzioni che toccano il DB sono async. Le API routes devono
//   fare `await`. Questo è richiesto per supportare Postgres (l'adapter
//   pg è async-only). Con SQLite l'await è trasparente (l'adapter
//   restituisce Promise risolte immediatamente).

import type { DbInterface } from './db-factory';
import { LEAGUE_RULES, ROSTER_SIZE } from './league-rules';

export type AuctionEvent = {
  sequenceId: number;
  type: 'PURCHASE' | 'UNSOLD' | 'COMPENSATE' | 'PHASE_CHANGE' | 'START' | 'PAUSE' | 'RESUME' | 'COMPLETE';
  ts: string;
  idempotencyKey: string | null;
  payload: Record<string, any>;
  compensatedSequenceId: number | null;
};

export type ManagerState = {
  id: number;
  name: string;
  isOwner: boolean;
  initialCredits: number;
  spent: number;
  credits: number;
  byRole: { P: number; D: number; C: number; A: number };
  players: Array<{ playerId: number; name: string; ruolo: string; squadra: string; prezzo: number; ts: string }>;
};

export type AuctionSnapshot = {
  state: 'DRAFT' | 'READY' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  phase: 'P' | 'D' | 'C' | 'A';
  stateVersion: number;
  startedAt: string | null;
  completedAt: string | null;
  managers: ManagerState[];
  playerStatus: Record<string, 'sold' | 'unsold' | 'free'>;
  playerOwner: Record<string, number>;  // playerId -> managerId
  events: AuctionEvent[];
};

// ============= SETUP SCHEMA =============

/** Legge i nomi dei manager dal DB per popolare lo snapshot. */
export async function loadManagerNames(db: DbInterface): Promise<Record<number, {name: string; isOwner: boolean}>> {
  try {
    const rows = await db.prepare('SELECT id, name, is_owner FROM managers').all();
    const out: Record<number, {name: string; isOwner: boolean}> = {};
    for (const r of rows) {
      out[r.id] = { name: r.name ?? '', isOwner: r.is_owner === 1 || r.is_owner === '1' };
    }
    return out;
  } catch {
    return {};
  }
}

export async function setupEventsSchema(db: DbInterface): Promise<void> {
  // SQLite (dialect) — funziona anche Postgres che ignora AUTOINCREMENT (la tabella
  // è già stata creata da db-sqlite/db-postgres init). Idempotente via IF NOT EXISTS.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS auction_events (
      sequence_id      INTEGER PRIMARY KEY AUTOINCREMENT,
      type             TEXT NOT NULL,
      ts               TEXT NOT NULL,
      idempotency_key  TEXT UNIQUE,
      payload_json     TEXT NOT NULL,
      compensated_seq  INTEGER,
      FOREIGN KEY (compensated_seq) REFERENCES auction_events(sequence_id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_type ON auction_events(type);
    CREATE INDEX IF NOT EXISTS idx_events_comp ON auction_events(compensated_seq);
  `);
}

// ============= IDEMPOTENCY HELPERS =============

/** Cerca un evento già registrato con la stessa idempotency key. */
export async function findEventByIdempotencyKey(db: DbInterface, key: string | null | undefined): Promise<AuctionEvent | null> {
  if (!key) return null;
  const row = await db.prepare(
    `SELECT sequence_id, type, ts, idempotency_key, payload_json, compensated_seq
     FROM auction_events WHERE idempotency_key = ?`
  ).get(key);
  if (!row) return null;
  return rowToEvent(row);
}

function rowToEvent(row: any): AuctionEvent {
  return {
    sequenceId: Number(row.sequence_id),
    type: row.type,
    ts: row.ts,
    idempotencyKey: row.idempotency_key,
    payload: JSON.parse(row.payload_json),
    compensatedSequenceId: row.compensated_seq != null ? Number(row.compensated_seq) : null,
  };
}

// ============= LETTURA EVENTI =============

export async function listAllEvents(db: DbInterface): Promise<AuctionEvent[]> {
  const rows = await db.prepare(
    `SELECT sequence_id, type, ts, idempotency_key, payload_json, compensated_seq
     FROM auction_events ORDER BY sequence_id ASC`
  ).all();
  return rows.map(rowToEvent);
}

// ============= REPLAY =============
// Dato l'event log, ricostruisce lo stato corrente.
// NON muta il database: solo calcolo in memoria.

export async function replay(db: DbInterface, ds: any, managerNames?: Record<number, {name: string; isOwner: boolean}>): Promise<AuctionSnapshot> {
  const events = await listAllEvents(db);
  return replayFromEvents(events, ds, managerNames);
}

export function replayFromEvents(
  events: AuctionEvent[],
  ds: any,
  managerNames?: Record<number, {name: string; isOwner: boolean}>,
): AuctionSnapshot {
  const snap: AuctionSnapshot = {
    state: 'DRAFT',
    phase: 'P',
    stateVersion: 0,
    startedAt: null,
    completedAt: null,
    managers: [],
    playerStatus: {},
    playerOwner: {},
    events,
  };

  // Inizializza managers
  const emptyManagers = Array.from({ length: LEAGUE_RULES.managerCount }, (_, i) => {
    const slot = i + 1;
    const fromDb = managerNames?.[slot];
    return {
      id: slot,
      name: fromDb?.name ?? '',
      isOwner: fromDb?.isOwner ?? (slot === 1),
      initialCredits: LEAGUE_RULES.initialCredits,
      spent: 0,
      credits: LEAGUE_RULES.initialCredits,
      byRole: { P: 0, D: 0, C: 0, A: 0 },
      players: [],
    };
  });
  snap.managers = emptyManagers;

  for (const e of events) {
    applyEvent(snap, e, ds);
  }
  snap.stateVersion = events.length;
  return snap;
}

function applyEvent(snap: AuctionSnapshot, e: AuctionEvent, ds: any) {
  const player = (id: number) => ds.players.find((p: any) => p.id === id);
  const manager = (id: number) => snap.managers.find((m) => m.id === id);

  switch (e.type) {
    case 'START':
      snap.state = 'LIVE';
      snap.startedAt = e.ts;
      break;

    case 'PAUSE':
      snap.state = 'PAUSED';
      break;

    case 'RESUME':
      snap.state = 'LIVE';
      break;

    case 'COMPLETE':
      snap.state = 'COMPLETED';
      snap.completedAt = e.ts;
      break;

    case 'PHASE_CHANGE':
      snap.phase = e.payload.newPhase;
      break;

    case 'PURCHASE': {
      const { playerId, managerId, price } = e.payload;
      const p = player(playerId);
      const m = manager(managerId);
      if (!p || !m) return;
      m.spent += price;
      m.credits -= price;
      m.players.push({
        playerId, name: p.nome, ruolo: p.ruolo, squadra: p.squadra, prezzo: price, ts: e.ts,
      });
      m.byRole[p.ruolo] = (m.byRole[p.ruolo] || 0) + 1;
      snap.playerStatus[playerId] = 'sold';
      snap.playerOwner[playerId] = managerId;
      break;
    }

    case 'UNSOLD': {
      const { playerId } = e.payload;
      snap.playerStatus[playerId] = 'unsold';
      break;
    }

    case 'COMPENSATE': {
      break;
    }
  }
}

/**
 * Replay "logico" che rispetta l'undo.
 */
export async function replayEffective(
  db: DbInterface,
  ds: any,
  managerNames?: Record<number, {name: string; isOwner: boolean}>,
): Promise<AuctionSnapshot> {
  const events = await listAllEvents(db);
  return replayEffectiveFromEvents(events, ds, managerNames);
}

export function replayEffectiveFromEvents(
  events: AuctionEvent[],
  ds: any,
  managerNames?: Record<number, {name: string; isOwner: boolean}>,
): AuctionSnapshot {
  const compensated = new Set<number>();
  for (const e of events) {
    if (e.type === 'COMPENSATE' && e.compensatedSequenceId != null) {
      compensated.add(e.compensatedSequenceId);
    }
  }
  const effective = events.filter((e) =>
    e.type === 'COMPENSATE' || !compensated.has(e.sequenceId)
  );

  const snap = replayFromEvents(effective, ds, managerNames);
  snap.events = effective;
  return snap;
}

// ============= SCRITTURA EVENTI (transazione) =============

/**
 * Appende un evento al log, con gestione idempotency.
 * Se la idempotencyKey è già presente, ritorna l'evento esistente (no duplicato).
 * Restituisce { event, duplicate }.
 *
 * L'adapter Postgres usa INSERT ... RETURNING sequence_id (eseguito da appendEvent
 * stesso, non dall'adapter) per ottenere l'id generato. SQLite ha lastInsertRowid.
 */
export async function appendEvent(
  db: DbInterface,
  input: { type: AuctionEvent['type']; payload: Record<string, any>; idempotencyKey?: string | null; compensatedSeq?: number | null },
): Promise<{ event: AuctionEvent; duplicate: boolean }> {
  if (input.idempotencyKey) {
    const existing = await findEventByIdempotencyKey(db, input.idempotencyKey);
    if (existing) return { event: existing, duplicate: true };
  }

  const ts = new Date().toISOString();

  // INSERT con RETURNING sequence_id: funziona su Postgres; su SQLite
  // l'UNIQUE INDEX cattura la violazione, ma lastInsertRowid è su .run()
  const insertSql = `INSERT INTO auction_events (type, ts, idempotency_key, payload_json, compensated_seq)
                      VALUES (?, ?, ?, ?, ?)
                      RETURNING sequence_id`;

  try {
    const result = await db.prepare(insertSql).run(
      input.type, ts, input.idempotencyKey ?? null,
      JSON.stringify(input.payload), input.compensatedSeq ?? null,
    );
    const seq = Number(result.lastInsertRowid);
    return {
      event: { sequenceId: seq, type: input.type, ts, idempotencyKey: input.idempotencyKey ?? null, payload: input.payload, compensatedSequenceId: input.compensatedSeq ?? null },
      duplicate: false,
    };
  } catch (err: any) {
    // Postgres: unique_violation (codice 23505) — la chiave idempotency è stata
    // inserita tra il findEventByIdempotencyKey e l'insert (race condition).
    // Ripesca l'evento esistente.
    if (err?.code === '23505' && input.idempotencyKey) {
      const existing = await findEventByIdempotencyKey(db, input.idempotencyKey);
      if (existing) return { event: existing, duplicate: true };
    }
    throw err;
  }
}

// ============= ACQUISTO SICURO =============

export type PurchaseInput = {
  playerId: number;
  managerId: number;
  price: number;
  idempotencyKey?: string;
};

export type PurchaseResult =
  | { ok: true; event: AuctionEvent; duplicate: boolean }
  | { ok: false; errors: string[] };

/**
 * Registra un acquisto applicando TUTTE le invarianti.
 */
export async function recordPurchaseSafe(db: DbInterface, ds: any, input: PurchaseInput): Promise<PurchaseResult> {
  // 1) IDEMPOTENCY
  if (input.idempotencyKey) {
    const existing = await findEventByIdempotencyKey(db, input.idempotencyKey);
    if (existing) return { ok: true, event: existing, duplicate: true };
  }

  const errors: string[] = [];
  const player = ds.players.find((p: any) => p.id === input.playerId);
  if (!player) errors.push('Calciatore non trovato');
  if (!Number.isInteger(input.price) || input.price <= 0) errors.push('Prezzo deve essere intero positivo');

  // ricostruisci stato attuale
  const snap = await replayEffective(db, ds);
  if (snap.state !== 'LIVE') errors.push(`Asta non in LIVE (stato attuale: ${snap.state})`);

  const mgr = snap.managers.find((m) => m.id === input.managerId);
  if (!mgr) errors.push('Manager non trovato');

  if (snap.playerStatus[input.playerId] === 'sold') errors.push('Calciatore già venduto');
  if (snap.playerStatus[input.playerId] === 'unsold') errors.push('Calciatore dichiarato invenduto in questa sessione');

  if (player && mgr) {
    const rosa = LEAGUE_RULES.roster;
    if (mgr.byRole[player.ruolo] >= rosa[player.ruolo]) {
      errors.push(`Slot ${player.ruolo} pieno per ${mgr.name} (${mgr.byRole[player.ruolo]}/${rosa[player.ruolo]})`);
    }
    if (mgr.credits < input.price) {
      errors.push(`Crediti insufficienti: ${mgr.name} ha ${mgr.credits}, servono ${input.price}`);
    }
    const emptySlots = ROSTER_SIZE - mgr.players.length;
    const ceiling = mgr.credits - emptySlots;
    if (input.price > ceiling) {
      errors.push(`Prezzo ${input.price} supera il tetto ${ceiling} (per chiudere la rosa)`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Append evento
  const result = await appendEvent(db, {
    type: 'PURCHASE',
    payload: { playerId: input.playerId, managerId: input.managerId, price: input.price },
    idempotencyKey: input.idempotencyKey ?? null,
  });
  return { ok: true, event: result.event, duplicate: result.duplicate };
}

// ============= UNDO (evento compensativo) =============

export type UndoResult = { ok: true; undone: AuctionEvent; compensate: AuctionEvent } | { ok: false; errors: string[] };

export async function undoLast(db: DbInterface, idempotencyKey?: string): Promise<UndoResult> {
  const events = await listAllEvents(db);
  const compensated = new Set<number>();
  for (const e of events) {
    if (e.type === 'COMPENSATE' && e.compensatedSequenceId != null) compensated.add(e.compensatedSequenceId);
  }
  let target: AuctionEvent | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if ((e.type === 'PURCHASE' || e.type === 'UNSOLD') && !compensated.has(e.sequenceId)) {
      target = e; break;
    }
  }
  if (!target) return { ok: false, errors: ['Nessun acquisto o invenduto da annullare'] };

  const result = await appendEvent(db, {
    type: 'COMPENSATE',
    payload: { reason: 'undo' },
    compensatedSeq: target.sequenceId,
    idempotencyKey: idempotencyKey ?? null,
  });
  return { ok: true, undone: target, compensate: result.event };
}

// ============= INVENDUTO =============

export async function markUnsoldSafe(db: DbInterface, playerId: number, idempotencyKey?: string) {
  return appendEvent(db, {
    type: 'UNSOLD',
    payload: { playerId },
    idempotencyKey: idempotencyKey ?? null,
  });
}

// ============= STATO ASTA =============

export function startAuction(db: DbInterface, idempotencyKey?: string) {
  return appendEvent(db, { type: 'START', payload: {}, idempotencyKey: idempotencyKey ?? null });
}
export function pauseAuction(db: DbInterface, idempotencyKey?: string) {
  return appendEvent(db, { type: 'PAUSE', payload: {}, idempotencyKey: idempotencyKey ?? null });
}
export function resumeAuction(db: DbInterface, idempotencyKey?: string) {
  return appendEvent(db, { type: 'RESUME', payload: {}, idempotencyKey: idempotencyKey ?? null });
}
export function completeAuction(db: DbInterface, idempotencyKey?: string) {
  return appendEvent(db, { type: 'COMPLETE', payload: {}, idempotencyKey: idempotencyKey ?? null });
}
export function changePhase(db: DbInterface, newPhase: 'P' | 'D' | 'C' | 'A', idempotencyKey?: string) {
  return appendEvent(db, { type: 'PHASE_CHANGE', payload: { newPhase }, idempotencyKey: idempotencyKey ?? null });
}
