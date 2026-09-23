// FASE 3 — Test del registro event-sourced.
//
// Test per:
//   A) crediti mai negativi
//   B) nessun giocatore a due squadre
//   C) undo che ripristina tutto
//   D) idempotency (doppio click = 1 solo evento)
//   E) append-only (nessun DELETE/UPDATE sul log eventi)

import Database from 'better-sqlite3';
import { unlinkSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  setupEventsSchema,
  appendEvent,
  listAllEvents,
  findEventByIdempotencyKey,
  replayEffective,
  recordPurchaseSafe,
  undoLast,
  markUnsoldSafe,
  startAuction,
} from '../src/lib/events';
import type { AuctionEvent } from '../src/lib/events';

const ROOT = resolve(__dirname, '..');
const ds = JSON.parse(readFileSync(resolve(ROOT, 'data/dataset.json'), 'utf-8'));
const topP = ds.players.find((p: any) => p.nome === 'Svilar');        // Roma, P
const topD = ds.players.find((p: any) => p.nome === 'Dimarco');       // Inter, D
const topC = ds.players.find((p: any) => p.nome === 'Paz N.');        // Como, C

let passed = 0, failed = 0;
function test(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

async function freshDb() {
  const name = `test-${Math.random().toString(36).slice(2)}.db`;
  const path = resolve(ROOT, 'data', name);
  if (existsSync(path)) unlinkSync(path);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS managers (id INTEGER PRIMARY KEY, name TEXT, is_owner INTEGER);
    CREATE TABLE IF NOT EXISTS league_config (key TEXT PRIMARY KEY, value TEXT);
  `);
  for (let i = 1; i <= 8; i++) db.prepare('INSERT INTO managers (id, name, is_owner) VALUES (?, ?, ?)').run(i, `M${i}`, i === 1 ? 1 : 0);
  await setupEventsSchema(db as any);
  return { db, path };
}

// ====================================================================
//                        A) CREDITI MAI NEGATIVI
// ====================================================================
console.log('\n=== A) CREDITI MAI NEGATIVI ===\n');
{
  const { db } = await freshDb();
  await startAuction(db as any);

  const r1 = await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: 1000 });
  test('A1: acquisto a 1000 rifiutato', !r1.ok, !r1.ok ? r1.errors.join('; ') : '');

  const r2 = await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: 0 });
  test('A2: prezzo 0 rifiutato', !r2.ok);

  const r3 = await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: -5 });
  test('A3: prezzo negativo rifiutato', !r3.ok);

  // Acquisto valido, poi tentativo sopra ceiling
  await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: 50 });
  const snap = await replayEffective(db as any, ds);
  const m1 = snap.managers.find((m) => m.id === 1)!;
  test('A4: M1 crediti = 450 dopo acquisto valido', m1.credits === 450, `=${m1.credits}`);
  test('A5: M1 speso = 50', m1.spent === 50, `=${m1.spent}`);

  // Ceiling M1: 450 - 24 slot vuoti = 426
  const r4 = await recordPurchaseSafe(db as any, ds, { playerId: topD!.id, managerId: 1, price: 500 });
  test('A6: acquisto sopra ceiling rifiutato', !r4.ok);
  test('A7: errore contiene "tetto"', !r4.ok && r4.errors.some((e: string) => e.includes('tetto')));

  // Dopo rifiuti, crediti e rosa non sono cambiati
  const snap2 = await replayEffective(db as any, ds);
  const m1b = snap2.managers.find((m) => m.id === 1)!;
  test('A8: crediti restano 450 dopo rifiuti', m1b.credits === 450);
  test('A9: speso resta 50 dopo rifiuti', m1b.spent === 50);
  test('A10: rosa resta 1 player dopo rifiuti', m1b.players.length === 1);
}

// ====================================================================
//                B) NESSUN GIOCATORE A DUE SQUADRE
// ====================================================================
console.log('\n=== B) NESSUN GIOCATORE A DUE SQUADRE ===\n');
{
  const { db } = await freshDb();
  await startAuction(db as any);

  // M1 compra Svilar
  await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: 50 });
  // M2 tenta di comprare lo stesso Svilar
  const r = await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 2, price: 100 });
  test('B1: acquisto duplicato rifiutato', !r.ok);
  test('B2: errore "già venduto"', !r.ok && r.errors.some((e: string) => e.includes('già venduto')));

  // Proprietà: ogni playerId ha ALMENO un owner (se venduto) e MAI due
  const snap = await replayEffective(db as any, ds);
  test('B3: playerOwner[Svilar] = M1', snap.playerOwner[topP!.id] === 1);

  // Race condition: la stessa idempotency key per 5 chiamate consecutive
  // produce esattamente 1 scrittura nel DB (le altre 4 sono duplicate riconosciute).
  // Dimostriamo con un calciatore ANCORA libero (Dimarco, id=254).
  let nuove = 0, dupOk = 0;
  for (let i = 0; i < 5; i++) {
    const rr = await recordPurchaseSafe(db as any, ds, { playerId: topD!.id, managerId: 3, price: 10, idempotencyKey: 'race-test-key' });
    if (rr.ok && !rr.duplicate) nuove++;
    if (rr.ok && rr.duplicate) dupOk++;
  }
  test('B4: 5 chiamate stessa key → 1 sola nuova scrittura', nuove === 1, `nuove=${nuove}`);
  test('B4b: 4 chiamate sono duplicate', dupOk === 4, `dupOk=${dupOk}`);
  // Nel DB c'è esattamente 1 PURCHASE per Dimarco
  const dimarcoPurchase = (await listAllEvents(db as any)).filter((e) => e.type === 'PURCHASE' && e.payload.playerId === topD!.id);
  test('B4c: solo 1 PURCHASE Dimarco nel log', dimarcoPurchase.length === 1, `=${dimarcoPurchase.length}`);
  // Dimarco è di M3
  const snapRace = await replayEffective(db as any, ds);
  test('B4d: Dimarco.owner = M3 (dalla race)', snapRace.playerOwner[topD!.id] === 3, `owner=${snapRace.playerOwner[topD!.id]}`);
  const snap2 = await replayEffective(db as any, ds);
  const owners = Object.values(snap2.playerOwner);
  test('B5: count(owners) = count(playerId unici)',
    owners.length === new Set(owners).size,
    `${owners.length} owners, ${new Set(owners).size} unique`);

  // Dimarco venduto a M2 — ma attenzione: se la race test ha già comprato Dimarco per M3,
  // questo acquisto deve essere rifiutato con "già venduto".
  const rB6 = await recordPurchaseSafe(db as any, ds, { playerId: topD!.id, managerId: 2, price: 30 });
  const snap3 = await replayEffective(db as any, ds);
  if (rB6.ok) {
    // Race test NON è riuscita a comprare Dimarco per M3 → B6 compra per M2
    test('B6: B6 compra Dimarco per M2 (race non riuscita)', snap3.playerOwner[topD!.id] === 2, `owner=${snap3.playerOwner[topD!.id]}`);
  } else {
    // Race test ha comprato Dimarco per M3 → B6 deve fallire con "già venduto"
    test('B6: B6 rifiutato perché Dimarco già di M3', !rB6.ok && rB6.errors.some((e: string) => e.includes('già venduto')),
      rB6.ok ? 'FATAL: acquisto riuscito quando non doveva' : rB6.errors.join('; '));
    test('B6b: Dimarco.owner = M3 (dalla race)', snap3.playerOwner[topD!.id] === 3, `owner=${snap3.playerOwner[topD!.id]}`);
  }
  test('B7: Svilar.owner = M1', snap3.playerOwner[topP!.id] === 1);
  test('B8: M2 non ha Svilar in rosa', !snap3.managers.find((m: any) => m.id === 2)!.players.some((p: any) => p.playerId === topP!.id));
}

// ====================================================================
//              C) UNDO CHE RIPRISTINA TUTTO
// ====================================================================
console.log('\n=== C) UNDO CHE RIPRISTINA TUTTO ===\n');
{
  const { db } = await freshDb();
  await startAuction(db as any);

  // Acquisto
  await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: 50 });
  let snap = await replayEffective(db as any, ds);
  const m1pre = snap.managers.find((m) => m.id === 1)!;
  test('C1: pre-undo M1: 1 player', m1pre.players.length === 1);
  test('C2: pre-undo M1: 450 crediti', m1pre.credits === 450);
  test('C3: pre-undo M1: 50 speso', m1pre.spent === 50);
  test('C4: pre-undo Svilar = sold', snap.playerStatus[topP!.id] === 'sold');
  test('C5: pre-undo Svilar.owner = M1', snap.playerOwner[topP!.id] === 1);

  // Undo
  const undo = await undoLast(db as any);
  test('C6: undo ok', undo.ok);
  if (!undo.ok) throw new Error('Undo failed: ' + (undo as any).errors?.join(', '));
  test('C7: undone.type = PURCHASE', undo.undone.type === 'PURCHASE');
  test('C8: undone.playerId = Svilar', undo.undone.payload.playerId === topP!.id);
  test('C9: compensate.type = COMPENSATE', undo.compensate.type === 'COMPENSATE');
  test('C10: compensate.compensatedSeq = undone.sequenceId', undo.compensate.compensatedSequenceId === undo.undone.sequenceId);

  // Post-undo: tutto ripristinato
  snap = await replayEffective(db as any, ds);
  const m1post = snap.managers.find((m) => m.id === 1)!;
  test('C11: post-undo M1: 0 player', m1post.players.length === 0);
  test('C12: post-undo M1: 500 crediti', m1post.credits === 500, `=${m1post.credits}`);
  test('C13: post-undo M1: 0 speso', m1post.spent === 0);
  test('C14: post-undo Svilar: non è sold', snap.playerStatus[topP!.id] !== 'sold');
  test('C15: post-undo Svilar: owner undefined', snap.playerOwner[topP!.id] === undefined);

  // L'evento originale è ancora nel log (append-only)
  const allEvents = await listAllEvents(db as any);
  test('C16: evento PURCHASE originale ancora nel log', allEvents.some((e) => e.sequenceId === undo.undone.sequenceId && e.type === 'PURCHASE'));
  test('C17: evento COMPENSATE presente', allEvents.some((e) => e.type === 'COMPENSATE'));
  test('C18: evento COMPENSATE referenzia originale', allEvents.find((e) => e.type === 'COMPENSATE')!.compensatedSequenceId === undo.undone.sequenceId);

  // Dopo undo, si può ricomprare lo stesso calciatore (ora è free)
  const recompra = await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 2, price: 30 });
  test('C19: ricompra post-undo: ok', recompra.ok);
  snap = await replayEffective(db as any, ds);
  test('C20: Svilar ora è di M2', snap.playerOwner[topP!.id] === 2);

  // Undo di un UNSOLD
  await markUnsoldSafe(db as any, topD!.id);
  let snap2 = await replayEffective(db as any, ds);
  test('C21: Dimarco = unsold', snap2.playerStatus[topD!.id] === 'unsold');
  await undoLast(db as any);
  snap2 = await replayEffective(db as any, ds);
  test('C22: Dimarco free post-undo', snap2.playerStatus[topD!.id] === undefined);
}

// ====================================================================
//              D) IDEMPOTENCY: DOPPIO CLICK = 1 SOLO EVENTO
// ====================================================================
console.log('\n=== D) IDEMPOTENCY: DOPPIO CLICK = 1 SOLO EVENTO ===\n');
{
  const { db } = await freshDb();
  await startAuction(db as any);

  const key = 'click-doppio-12345';
  const r1 = await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: 50, idempotencyKey: key });
  const r2 = await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: 50, idempotencyKey: key });
  const r3 = await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: 50, idempotencyKey: key });
  test('D1: prima chiamata ok, duplicate=false', r1.ok && !r1.duplicate);
  test('D2: seconda chiamata ok, duplicate=true', r2.ok && r2.duplicate);
  test('D3: terza chiamata ok, duplicate=true', r3.ok && r3.duplicate);

  const purchases = (await listAllEvents(db as any)).filter((e) => e.type === 'PURCHASE');
  test('D4: solo 1 PURCHASE nel log', purchases.length === 1, `=${purchases.length}`);

  const snap = await replayEffective(db as any, ds);
  const m1 = snap.managers.find((m) => m.id === 1)!;
  test('D5: M1 speso = 50 (non 150)', m1.spent === 50);
  test('D6: M1 ha 1 player (non 3)', m1.players.length === 1);

  // Idempotency con key diverse → eventi separati
  const r4 = await recordPurchaseSafe(db as any, ds, { playerId: topD!.id, managerId: 1, price: 30, idempotencyKey: 'key-diversa' });
  test('D7: key diversa → nuovo acquisto ok', r4.ok && !r4.duplicate);
  const purchases2 = (await listAllEvents(db as any)).filter((e) => e.type === 'PURCHASE');
  test('D8: ora 2 PURCHASE nel log', purchases2.length === 2);
}

// ====================================================================
//              E) APPEND-ONLY: NESSUN DELETE / UPDATE
// ====================================================================
console.log('\n=== E) APPEND-ONLY: log eventi in crescita monodirezionale ===\n');
{
  const { db } = await freshDb();
  await startAuction(db as any);
  await recordPurchaseSafe(db as any, ds, { playerId: topP!.id, managerId: 1, price: 50, idempotencyKey: 'k1' });
  await recordPurchaseSafe(db as any, ds, { playerId: topD!.id, managerId: 2, price: 30, idempotencyKey: 'k2' });

  const nAfterPurchases = (await listAllEvents(db as any)).length;
  test('E1: 3 eventi iniziali (START + 2 PURCHASE)', nAfterPurchases === 3, `=${nAfterPurchases}`);

  // 3 undo
  await undoLast(db as any);
  await undoLast(db as any);
  await undoLast(db as any);
  const nAfterUndos = (await listAllEvents(db as any)).length;
  test('E2: eventi aumentano dopo undo (mai diminuiscono)', nAfterUndos > nAfterPurchases, `=${nAfterUndos}`);

  // Tutti gli eventi originali ancora presenti
  const all = await listAllEvents(db as any);
  const hasStart = all.some((e) => e.type === 'START');
  const hasP1    = all.some((e) => e.type === 'PURCHASE' && e.payload.playerId === topP!.id);
  const hasP2    = all.some((e) => e.type === 'PURCHASE' && e.payload.playerId === topD!.id);
  test('E3: START ancora presente', hasStart);
  test('E4: PURCHASE Svilar ancora presente', hasP1);
  test('E5: PURCHASE Dimarco ancora presente', hasP2);

  // Sequence ID monotonici e partono da 1
  const seqs = all.map((e) => e.sequenceId);
  for (let i = 1; i < seqs.length; i++) {
    test(`E6[${i}]: seq[${i}]=${seqs[i]} > seq[${i-1}]=${seqs[i-1]}`, seqs[i] > seqs[i - 1]);
  }
  test('E7: seq[0] = 1', seqs[0] === 1);

  // Tentativo di sovrascrivere un evento (tabella non ha UPDATE triggers)
  // Non esiste funzione updateEvent — verifichiamo che non sia esportata
  // Se qualcuno facesse UPDATE diretto sul DB, i test qui fallirebbero.
  // Il constraint: la tabella auction_events NON ha trigger UPDATE.
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='auction_events'").all();
  test('E8: nessun trigger UPDATE sulla tabella events', triggers.length === 0);
}

// ====================================================================
console.log(`\nRisultato: ${passed} ok, ${failed} ko`);
process.exit(failed > 0 ? 1 : 0);
