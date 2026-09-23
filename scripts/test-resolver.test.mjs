// FASE 2 — Test del Resolver
// Verifica la regola fondamentale: MAI indovinare, sempre BLOCCARE se ambiguo.

import { resolvePlayer, resolveBatch, assertResolvable } from './resolver.mjs';
import { readFileSync } from 'fs';

let passed = 0, failed = 0;
function test(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

console.log('\n=== TEST RESOLVER CALCIATORI ===\n');

// ---------- match esatto ----------
const r1 = resolvePlayer({ name: 'Svilar', squadra: 'Roma', ruolo: 'P' });
test('Match esatto Svilar/Roma/P → ok', r1.ok && r1.playerId === 5841,
     r1.ok ? `id=${r1.playerId}` : r1.reason);

// ---------- alias esplicito ----------
const r2 = resolvePlayer({ name: 'Martinez L.', ruolo: 'A' });
test('Alias "Martinez L." → Lautaro Martinez (2764)', r2.ok && r2.playerId === 2764,
     r2.ok ? `id=${r2.playerId} source=${r2.source}` : r2.reason);

const r3 = resolvePlayer({ name: 'Paz N.', ruolo: 'C' });
test('Alias "Paz N." → Nico Paz (6875)', r3.ok && r3.playerId === 6875,
     r3.ok ? `id=${r3.playerId}` : r3.reason);

// ---------- fuzzy per cognome (caso univoco) ----------
const r4 = resolvePlayer({ name: 'Wesley', ruolo: 'D' });
test('Fuzzy "Wesley"/D → ok (un solo Wesley difensore)', r4.ok && r4.playerId === 7181,
     r4.ok ? `id=${r4.playerId}` : r4.reason);

// ---------- AMBIGUITÀ: deve BLOCCARE ----------
const r5 = resolvePlayer({ name: 'Martinez' });
test('"Martinez" senza altre info → AMBIGUO (non indovina)', !r5.ok && r5.reason === 'ambiguous',
     r5.ok ? 'BUG: ha indovinato!' : `candidati: ${r5.candidates?.join(',')}`);

// verifica che esistano ALMENO 2 candidati (Lautaro A + Josep P)
const ds = JSON.parse(readFileSync('./data/dataset.json', 'utf-8'));
const martinezCount = ds.players.filter((p) => p.nome.toLowerCase().includes('martinez')).length;
test('Esistono ≥ 2 Martinez nel listone', martinezCount >= 2, `trovati: ${martinezCount}`);

// ---------- match con normalizzazione accenti/apostrofi ----------
const r6 = resolvePlayer({ name: "Dembèlé", ruolo: 'D' });
test('Normalizzazione accenti: Dembèlé → trovato', r6.ok, r6.ok ? `id=${r6.playerId}` : r6.reason);

// ---------- non risolto ----------
const r7 = resolvePlayer({ name: 'Calciatorinuovo', ruolo: 'A' });
test('Nome inesistente → unresolved', !r7.ok && r7.reason === 'unresolved');

// ---------- batch con report ----------
const batch = resolveBatch([
  { name: 'Svilar', ruolo: 'P' },
  { name: 'Martinez' },                // ambiguo
  { name: 'Wesley', ruolo: 'D' },      // fuzzy
  { name: 'Calciatorinuovo' },         // non risolto
], { strict: false });
test('Batch: 1 ambiguo rilevato', batch.ambiguous.length === 1);
test('Batch: 1 non risolto', batch.unresolved.length === 1);
test('Batch: 2 risolti', batch.resolved.length === 2);
test('Batch strict=false: NON blocca', batch.blocked === false);

// ---------- assertResolvable BLOCCA su ambiguo ----------
let blocked = false;
try {
  assertResolvable([{ name: 'Martinez' }]);
} catch (e) {
  blocked = true;
  test('assertResolvable LANCIA su ambiguo', e.report?.ambiguous?.length > 0);
}
test('assertResolvable blocca ingestion su ambiguo', blocked);

// ---------- assertResolvable NON blocca su tutto risolto ----------
let ok = false;
try {
  assertResolvable([{ name: 'Svilar', ruolo: 'P' }, { name: 'Paz N.', ruolo: 'C' }]);
  ok = true;
} catch (e) { /* niente */ }
test('assertResolvable OK su nomi tutti risolti', ok);

console.log(`\nRisultato: ${passed} ok, ${failed} ko`);
process.exit(failed > 0 ? 1 : 0);
