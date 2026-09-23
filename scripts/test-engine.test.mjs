// FASE 2C — Test del motore deterministico
// Verifica che le regole economiche e di rosa siano rispettate.

import {
  newAuctionState, recordPurchase, validatePurchase, calculateBidCeiling,
  managerSummary, markUnsold, undoLast, recommendBid, getPlayer, getManager,
} from './test-engine.mjs';

let passed = 0, failed = 0;
function test(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

console.log('\n=== TEST MOTORE DETERMINISTICO ===\n');

// ---------- setup ----------
const s = newAuctionState();
test('Stato iniziale: DRAFT', s.status === 'DRAFT');
test('8 manager creati', s.managers.length === 8);
test('Manager Elia è owner', getManager(s, 'Elia').isOwner === true);
test('Manager Elia ha 500 crediti', getManager(s, 'Elia').initialCredits === 500);
test('Rosa iniziale: 0 giocatori', getManager(s, 'Elia').players.length === 0);

// ---------- calcolo tetto spendibile ----------
// Elia ha 500 crediti, 0 giocatori su 25 slot → può spenderne 500 - 25 = 475
const elia = getManager(s, 'Elia');
test('Ceiling iniziale Elia: 475 (500 - 25 slot)', calculateBidCeiling(s, 'Elia') === 475);

// ---------- validazione prima dell'asta: deve fallire ----------
let r = recordPurchase(s, { playerId: 5841, managerSlot: 'Elia', price: 10 });
test('Acquisto in DRAFT rifiutato', !r.ok && r.errors.some((e) => e.includes('LIVE')));

// ---------- avvio asta ----------
s.status = 'LIVE';

// ---------- acquisto valido ----------
r = recordPurchase(s, { playerId: 5841, managerSlot: 'Elia', price: 50 });
test('Acquisto Svilar a 50 → ok', r.ok, r.errors ? r.errors.join(', ') : '');
test('Elia: 450 crediti rimasti', elia.credits === 450);
test('Elia: speso = 50', elia.spent === 50);
test('Elia: 1 portiere in rosa', elia.byRole.P === 1);
test('Stato: Svilar = sold', s.playerStatus[5841] === 'sold');
test('stateVersion = 1', s.stateVersion === 1);

// ---------- riacquisto stesso calciatore: deve fallire ----------
r = recordPurchase(s, { playerId: 5841, managerSlot: 'Condor', price: 5 });
test('Riacquisto Svilar rifiutato', !r.ok && r.errors.some((e) => e.includes('già acquistato')));

// ---------- prezzo troppo alto ----------
// Elia ha 450 crediti, 24 slot vuoti → ceiling = 426. 999 > 426 → rifiutato.
r = recordPurchase(s, { playerId: 4431, managerSlot: 'Elia', price: 999 });
test('Prezzo sopra ceiling rifiutato', !r.ok && r.errors.some((e) => e.includes('tetto')));

// ---------- slot pieno (3 portieri) ----------
recordPurchase(s, { playerId: 5116, managerSlot: 'Elia', price: 30 }); // Martinez Jo
recordPurchase(s, { playerId: 4964, managerSlot: 'Elia', price: 30 }); // Vicario
// ora Elia ha 3 portieri
r = recordPurchase(s, { playerId: 6966, managerSlot: 'Elia', price: 10 }); // Butez
test('4° portiere rifiutato (slot pieno)', !r.ok && r.errors.some((e) => e.includes('Slot P pieno')));

// ---------- credito insufficiente ----------
// Condor compra Dimarco a 475 → restano 25 crediti
recordPurchase(s, { playerId: 254, managerSlot: 'Condor', price: 475 });
test('Condor: 25 crediti rimasti (500-475)', getManager(s, 'Condor').credits === 25);
r = recordPurchase(s, { playerId: 7181, managerSlot: 'Condor', price: 50 });
test('Condor: acquisto a 50 rifiutato (crediti 25 < 50)', !r.ok && r.errors.some((e) => e.includes('Crediti insufficienti')));

// ---------- mark unsold ----------
r = markUnsold(s, { playerId: 9999 });
test('markUnsold su id inesistente rifiutato', !r.ok);

r = markUnsold(s, { playerId: 2788 }); // Bremer
test('markUnsold Bremer → ok', r.ok);
test('Bremer = unsold', s.playerStatus[2788] === 'unsold');

// ---------- UNDO: annulla l'ultimo evento significativo (UNSOLD di Bremer) ----------
const undo1 = undoLast(s);
test('Undo 1 (UNSOLD Bremer): ok', undo1.ok);
test('Undo 1: evento annullato era UNSOLD', undo1.undone.event === 'UNSOLD');
test('Bremer di nuovo free (nessuno stato)', s.playerStatus[2788] === undefined);

// ---------- UNDO: annulla l'acquisto di Dimarco (ultimo PURCHASE attivo) ----------
const condor = getManager(s, 'Condor');
const creditiCondorPrimaUndo = condor.credits;
const undo2 = undoLast(s);
test('Undo 2 (acquisto Dimarco): ok', undo2.ok);
test('Undo 2: evento annullato era PURCHASE', undo2.undone.event === 'PURCHASE');
test('Undo 2: crediti Condor tornati al valore pre-acquisto', condor.credits === creditiCondorPrimaUndo + 475);
test('Undo 2: Condor ha 0 giocatori in rosa', condor.players.length === 0);
test('Undo 2: Dimarco di nuovo free', s.playerStatus[254] === undefined);

// ---------- UNDO: terzo undo — annulla l'ultimo acquisto attivo di Elia ----------
// Elia ha ancora Svilar(50), Martinez(30), Vicario(30). L'ultimo nel log = Vicario (id 4964).
const eliaCreditsPreUndo3 = elia.credits;
const undo3 = undoLast(s);
test('Undo 3 (ultimo acquisto attivo): ok', undo3.ok);
test('Undo 3: event = PURCHASE', undo3.undone.event === 'PURCHASE');
test('Undo 3: annullato Vicario (id 4964)', undo3.undone.playerId === 4964);
test('Undo 3: Vicario di nuovo free', s.playerStatus[4964] === undefined);
test('Undo 3: Elia ha 2 portieri (non 3)', elia.players.length === 2);
test('Undo 3: Elia ha riavuto 30 crediti', elia.credits === eliaCreditsPreUndo3 + 30);

// ---------- raccomandazione deterministica ----------
// Elia ha 500 crediti, 0 giocatori, 25 slot vuoti → ceiling 475
const rec = recommendBid(s, { playerId: 6966, managerSlot: 'Elia' }); // Butez P
test('Raccomandazione Butez: azione valida', ['BID_UP_TO', 'PASS', 'BUY'].includes(rec.action));
test('Raccomandazione: maxBid <= ceiling', rec.recommendedMaxBid <= rec.ceiling);
test('Raccomandazione: recommendedMaxBid >= 1', rec.recommendedMaxBid >= 1);
test('Raccomandazione: ragioni <= 3', rec.reasons.length <= 3);
test('Raccomandazione: confidence valida', ['LOW', 'MEDIUM', 'HIGH'].includes(rec.confidence));

// ---------- riepilogo manager ----------
// Dopo i 3 undo: Elia ha ancora Svilar e Martinez in rosa, ha speso 80, ha 420 crediti,
// 23 slot vuoti → ceiling = 420 - 23 = 397
const sum = managerSummary(s, 'Elia');
test('Riepilogo Elia: initial = 500', sum.initial === 500);
test('Riepilogo Elia: spent = 80 (50+30)', sum.spent === 80);
test('Riepilogo Elia: remaining = 420', sum.remaining === 420);
test('Riepilogo Elia: bidCeiling = 397 (420-23 slot)', sum.bidCeiling === 397);
test('Riepilogo Elia: 2 portieri', sum.byRole.P === 2);

// ---------- ricerca calciatori ----------
const risultati = (await import('./test-engine.mjs')).searchPlayers('Svilar');
// (usiamo sync approximation per il test)

// ---------- riepilogo finale ----------
console.log(`\nRisultato: ${passed} ok, ${failed} ko`);
process.exit(failed > 0 ? 1 : 0);
