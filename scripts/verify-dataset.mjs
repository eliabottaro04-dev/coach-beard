// Verifica qualitativa del dataset.
// Stampa: riepilogo, top per ruolo, esempi di match/non-match.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');

const ds = JSON.parse(readFileSync(resolve(ROOT, 'data/dataset.json'), 'utf-8'));

console.log('========================================');
console.log('  COACH BEARD — Dataset v' + ds.version);
console.log('  Generato:', ds.generatedAt);
console.log('========================================\n');

console.log('STATISTICHE');
console.log('  Calciatori totali:', ds.stats.totalPlayers);
console.log('  Per ruolo        :', JSON.stringify(ds.stats.byRole));
console.log('  Squadre serie A  :', ds.stats.teams);
console.log('  Pupilli marcati  :', ds.stats.pupilli);
console.log('  Con fascia guida :', ds.stats.withFascia);
console.log('  Con prezzo guida :', ds.stats.withPrezzoGuida);
console.log('  Con titolarità   :', ds.stats.withTitolarita);

console.log('\nSQUADRE:', ds.teams.join(', '));

// Top 5 per ruolo per quotazione attuale
const byRole = (r) => ds.players.filter((p) => p.ruolo === r)
  .sort((a, b) => (b.quotAttuale ?? 0) - (a.quotAttuale ?? 0))
  .slice(0, 5);

console.log('\nTOP 5 PORTIERI (per quotazione):');
for (const p of byRole('P')) {
  console.log(`  ${String(p.id).padStart(5)} ${p.nome.padEnd(20)} ${p.squadra.padEnd(12)} Qt.A=${p.quotAttuale} FVM=${p.fvm} fascia=${p.fascia} guida=${p.prezzoGuida}`);
}

console.log('\nTOP 5 DIFENSORI:');
for (const p of byRole('D')) {
  console.log(`  ${String(p.id).padStart(5)} ${p.nome.padEnd(20)} ${p.squadra.padEnd(12)} Qt.A=${p.quotAttuale} FVM=${p.fvm} fascia=${p.fascia} guida=${p.prezzoGuida}`);
}

console.log('\nTOP 5 CENTROCAMPISTI:');
for (const p of byRole('C')) {
  console.log(`  ${String(p.id).padStart(5)} ${p.nome.padEnd(20)} ${p.squadra.padEnd(12)} Qt.A=${p.quotAttuale} FVM=${p.fvm} fascia=${p.fascia} guida=${p.prezzoGuida}`);
}

console.log('\nTOP 5 ATTACCANTI:');
for (const p of byRole('A')) {
  console.log(`  ${String(p.id).padStart(5)} ${p.nome.padEnd(20)} ${p.squadra.padEnd(12)} Qt.A=${p.quotAttuale} FVM=${p.fvm} fascia=${p.fascia} guida=${p.prezzoGuida}`);
}

// Pupilli
console.log('\nI TUOI PUPILLI:');
for (const p of ds.players.filter((x) => x.pupillo)) {
  console.log(`  [${p.ruolo}] ${p.nome} (${p.squadra}) fascia=${p.fascia} guida=${p.prezzoGuida}`);
}

// Sanity check: assicurati che gli ID siano unici
const ids = new Set();
let dup = 0;
for (const p of ds.players) {
  if (ids.has(p.id)) dup++;
  ids.add(p.id);
}
console.log(`\nID unici: ${ids.size} (duplicati: ${dup})`);

// Conta quanti non hanno match con la guida personale
const senzaGuida = ds.players.filter((p) => !p.fascia);
console.log(`Senza fascia guida personale: ${senzaGuida.length} calciatori`);
console.log('  (sono i giocatori che non compaiono in StrategiaFanta — succede, sono le "ali"/riserve)');

// Quanti hanno FMV=0 o null (potenziale problema)
const fmvNull = ds.players.filter((p) => p.fvm == null || p.fvm === 0);
console.log(`Con FVM mancante/zero: ${fmvNull.length} (succede per chi non ha mai giocato in serie A)`);
