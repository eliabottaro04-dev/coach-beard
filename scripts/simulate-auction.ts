#!/usr/bin/env node
// Simulazione completa di un'asta.
// Esegue: 8 manager, acquisti in P/D/C/A, un errore con undo, un invenduto,
// un cambio di reparto, validazione rose e report finale.

import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SqliteDb } from '../src/lib/db-sqlite';
import {
  startAuction,
  recordPurchaseSafe,
  undoLast,
  markUnsoldSafe,
  changePhase,
  replayEffective,
} from '../src/lib/events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = join(ROOT, 'data', 'sim-auction.db');
const DATASET_PATH = join(ROOT, 'data', 'dataset.json');

if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

const db = new SqliteDb(DB_PATH).init();

const managerNames = ['Elia', 'Condor', 'Lucio', 'Lensi', 'Renzo', 'Galga', 'Tella', 'Nica', 'Squadra 9', 'Squadra 10'];
const realManagerCount = 8;

// Seed managers direttamente
const ins = db.prepare('INSERT INTO managers (id, name, is_owner) VALUES (?, ?, ?)');
managerNames.forEach((n, i) => ins.run(i + 1, n, i === 0 ? 1 : 0));

const ds = JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));

// Helper: trova calciatore per nome
function find(name: string) {
  return ds.players.find((p: any) => p.nome === name);
}

// Statistiche
const stats = { purchases: 0, undos: 0, unsolds: 0, phaseChanges: 0, errors: 0 };
function pp(emoji: string, msg: string) { console.log(`${emoji} ${msg}`); }

async function main() {
  pp('🚀', 'Inizio simulazione asta');

  // ── 1. Avvio asta ──
  await startAuction(db);
  pp('🏁', 'Asta avviata (stato LIVE, fase P)');

  // ── 2. Acquisti portieri ──
  console.log('\n📁 REPARTO PORTIERI');
  const portieri = [
    { player: 'Svilar', buyer: 1, price: 28 },
    { player: 'Maignan', buyer: 2, price: 30 },
    { player: 'Vicario', buyer: 3, price: 25 },
  ];
  for (const t of portieri) {
    const p = find(t.player);
    if (!p) { pp('❌', `Non trovo ${t.player}`); continue; }
    const r = await recordPurchaseSafe(db, ds, { playerId: p.id, managerId: t.buyer, price: t.price });
    if (r.ok) { stats.purchases++; pp('  ✓', `${p.nome} → ${managerNames[t.buyer-1]} a ${t.price}cr`); }
    else { stats.errors++; pp('  ✗', `${p.nome}: ${r.errors.join('; ')}`); }
  }

  // Acquisti difensori
  console.log('\n📁 REPARTO DIFENSORI');
  await changePhase(db, 'D');
  stats.phaseChanges++;
  pp('🔄', 'Cambio reparto: P → D');

  const difensori = [
    { player: 'Dimarco', buyer: 1, price: 35 },
    { player: 'Bastoni', buyer: 2, price: 30 },
    { player: 'Buongiorno', buyer: 3, price: 22 },
    { player: 'Gabbia', buyer: 4, price: 18 },
    { player: 'Tomori', buyer: 5, price: 15 },
    { player: 'Thiaw', buyer: 1, price: 200 },
  ];
  for (const t of difensori) {
    const p = find(t.player);
    if (!p) continue;
    const r = await recordPurchaseSafe(db, ds, { playerId: p.id, managerId: t.buyer, price: t.price });
    if (r.ok) { stats.purchases++; pp('  ✓', `${p.nome} → ${managerNames[t.buyer-1]} a ${t.price}cr`); }
    else { stats.errors++; pp('  ⚠', `Errore simulato su ${p.nome}: ${r.errors[0]}`); }
  }

  // ── 3. Errore e undo ──
  console.log('\n🔧 SIMULAZIONE ERRORE E UNDO');
  const adams = find('Adams A.');
  if (adams) {
    const r1 = await recordPurchaseSafe(db, ds, { playerId: adams.id, managerId: 6, price: 1 });
    if (r1.ok) {
      stats.purchases++;
      pp('  ⚠', `ERRORE: Adams A. → Galga a 1cr (sbagliato, doveva andare a Elia!)`);
      pp('  ↩', 'Undo in corso...');
      const undo = await undoLast(db);
      if (undo.ok) {
        stats.undos++;
        pp('  ✓', `Undo riuscito!Evento annullato: seq #${undo.undone.sequenceId}, compensate creato: seq #${undo.compensate.sequenceId}`);
        pp('  ✓', `Adams A. è di nuovo libero`);
      }
    }
  } else {
    pp('  ⚠', 'Adams A. non trovato nel dataset');
  }

  // ── 4. Invenduto ──
  console.log('\n📛 SIMULAZIONE INVENDUTO');
  const pavard = ds.players.find((p: any) => p.squadra === 'Inter' && p.ruolo === 'D');
  if (pavard) {
    const r = await markUnsoldSafe(db, pavard.id);
    if (r.event) { stats.unsolds++; pp('  ✓', `${pavard.nome} dichiarato invenduto`); }
  }

  // ── 5. Cambio reparto e centrocampisti ──
  console.log('\n📁 REPARTO CENTROCAMPISTI');
  await changePhase(db, 'C');
  stats.phaseChanges++;
  pp('🔄', 'Cambio reparto: D → C');

  const centrocampisti = [
    { player: 'Calhanoglu', buyer: 1, price: 45 },
    { player: 'Paz N.', buyer: 2, price: 50 },
    { player: 'Reijnders', buyer: 3, price: 30 },
  ];
  for (const t of centrocampisti) {
    const p = find(t.player);
    if (!p) continue;
    const r = await recordPurchaseSafe(db, ds, { playerId: p.id, managerId: t.buyer, price: t.price });
    if (r.ok) { stats.purchases++; pp('  ✓', `${p.nome} → ${managerNames[t.buyer-1]} a ${t.price}cr`); }
    else { stats.errors++; pp('  ✗', `${p.nome}: ${r.errors[0]}`); }
  }

  // ── 6. Attaccanti ──
  console.log('\n📁 REPARTO ATTACCANTI');
  await changePhase(db, 'A');
  stats.phaseChanges++;
  pp('🔄', 'Cambio reparto: C → A');

  const attaccanti = [
    { player: 'Martinez L.', buyer: 1, price: 90 },
    { player: 'Malen', buyer: 2, price: 25 },
  ];
  for (const t of attaccanti) {
    const p = find(t.player);
    if (!p) continue;
    const r = await recordPurchaseSafe(db, ds, { playerId: p.id, managerId: t.buyer, price: t.price });
    if (r.ok) { stats.purchases++; pp('  ✓', `${p.nome} → ${managerNames[t.buyer-1]} a ${t.price}cr`); }
    else { stats.errors++; pp('  ✗', `${p.nome}: ${r.errors[0]}`); }
  }

  // ── 7. Validazione rose finali ──
  console.log('\n🔍 VALIDAZIONE ROSE');
  const snap = await replayEffective(db, ds);
  console.log(`  Stato asta: ${snap.state}, reparto: ${snap.phase}`);
  console.log(`  Eventi totali nel log: ${snap.events.length}`);
  console.log('');

  const dbNames = db.prepare('SELECT id, name FROM managers').all() as Array<{id:number;name:string}>;

  const errors: string[] = [];
  for (const m of snap.managers) {
    const totalPlayers = m.players.length;
    const totalSpent = m.spent;
    const name = dbNames.find(n => n.id === m.id)?.name || `Manager ${m.id}`;
    const isPlaceholder = m.id > realManagerCount;
    const tag = isPlaceholder ? ' [PLACEHOLDER]' : '';
    console.log(`  ${name}${tag}: ${totalPlayers}/25 giocatori, ${totalSpent}cr spesi`);
    console.log(`     P ${m.byRole.P}/3, D ${m.byRole.D}/8, C ${m.byRole.C}/8, A ${m.byRole.A}/6`);
    if (isPlaceholder) continue;
    if (totalSpent > 500) errors.push(`${name} ha speso ${totalSpent} > 500`);
    if (m.byRole.P > 3) errors.push(`${name} ha ${m.byRole.P} portieri > 3`);
    if (m.byRole.D > 8) errors.push(`${name} ha ${m.byRole.D} difensori > 8`);
    if (m.byRole.C > 8) errors.push(`${name} ha ${m.byRole.C} centrocampisti > 8`);
    if (m.byRole.A > 6) errors.push(`${name} ha ${m.byRole.A} attaccanti > 6`);
  }

  const ownerCounts: Record<string, number> = {};
  for (const pid of Object.keys(snap.playerOwner)) {
    ownerCounts[pid] = (ownerCounts[pid] ?? 0) + 1;
  }
  const doppi = Object.entries(ownerCounts).filter(([, c]) => c > 1);
  if (doppi.length > 0) {
    errors.push(`Giocatori con più di un owner: ${doppi.map(([pid]) => pid).join(', ')}`);
  }

  console.log('\n' + '═'.repeat(50));
  console.log('📊 RIEPILOGO SIMULAZIONE');
  console.log('═'.repeat(50));
  console.log(`  Acquisti validi:     ${stats.purchases}`);
  console.log(`  Errori (rifiutati):  ${stats.errors}`);
  console.log(`  Undo:                ${stats.undos}`);
  console.log(`  Invenduti:           ${stats.unsolds}`);
  console.log(`  Cambi reparto:       ${stats.phaseChanges}`);
  console.log(`  Calciatori totali:   ${Object.keys(snap.playerOwner).length}`);
  console.log(`  Squadre reali:       8 (Elia, Condor, Lucio, Lensi, Renzo, Galga, Tella, Nica)`);
  console.log(`  Squadre placeholder: 2 (Squadra 9, Squadra 10) — da compilare`);
  console.log(`  Tetto non violato:   ${errors.length === 0 ? 'SÌ' : 'NO (' + errors.length + ' errori)'}`);
  if (errors.length > 0) {
    console.log('\n❌ ERRORI:');
    for (const e of errors) console.log(`  - ${e}`);
  } else {
    console.log('\n✅ Tutte le rose sono valide!');
  }

  db.close();
}

main().catch((err) => { console.error('❌ Errore:', err); process.exit(1); });
