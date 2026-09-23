// FASE 2A — Test di qualità del dataset
// Verifica che il dataset abbia tutte le proprietà attese.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');

let passed = 0, failed = 0;
function test(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

const ds = JSON.parse(readFileSync(resolve(ROOT, 'data/dataset.json'), 'utf-8'));

console.log('\n=== TEST QUALITÀ DATASET ===\n');

test('Dataset caricato', ds && ds.players);
test('Almeno 500 calciatori', ds.players.length >= 500, `(trovati ${ds.players.length})`);

const ids = new Set(ds.players.map((p) => p.id));
test('Tutti gli ID sono unici', ids.size === ds.players.length, `(unici: ${ids.size}, totali: ${ds.players.length})`);

const ruoli = ['P', 'D', 'C', 'A'];
for (const r of ruoli) {
  const n = ds.players.filter((p) => p.ruolo === r).length;
  test(`Ruolo ${r}: almeno 50 calciatori`, n >= 50, `(trovati ${n})`);
}

const sqUniche = new Set(ds.players.map((p) => p.squadra));
test('Squadre di Serie A: 20', sqUniche.size === 20, `(trovate ${sqUniche.size}: ${[...sqUniche].join(', ')})`);

const conQuotazione = ds.players.filter((p) => p.quotAttuale != null).length;
test(`Quotazione attuale presente per >90% calciatori`, conQuotazione / ds.players.length > 0.9,
     `(${(conQuotazione / ds.players.length * 100).toFixed(1)}%)`);

const conFascia = ds.players.filter((p) => p.fascia).length;
test(`Fascia guida presente per >80% calciatori`, conFascia / ds.players.length > 0.8,
     `(${(conFascia / ds.players.length * 100).toFixed(1)}%)`);

const conPupillo = ds.players.filter((p) => p.pupillo).length;
test('Pupilli: almeno 10 marcati', conPupillo >= 10, `(marcati ${conPupillo})`);

const conPrezzoGuida = ds.players.filter((p) => p.prezzoGuida != null).length;
test('Prezzo guida presente per >50% calciatori', conPrezzoGuida / ds.players.length > 0.5,
     `(${(conPrezzoGuida / ds.players.length * 100).toFixed(1)}%)`);

// verifica un campione specifico di giocatori noti
const topPlayers = ['Svilar', 'Dimarco', 'Calhanoglu', 'Malen', 'Paz N.'];
for (const nome of topPlayers) {
  const found = ds.players.find((p) => p.nome === nome);
  test(`Giocatore top "${nome}" presente e con FVM>50`, found && found.fvm >= 50,
       found ? `(FVM=${found.fvm})` : 'non trovato');
}

console.log(`\nRisultato: ${passed} ok, ${failed} ko`);
process.exit(failed > 0 ? 1 : 0);
