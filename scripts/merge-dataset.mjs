// Genera nuovo dataset.json fondendo excel_players.json (nuovo listone) + dataset.json esistente
import fs from 'fs';

const newPlayersRaw = JSON.parse(fs.readFileSync('data/excel_players.json', 'utf8'));
const ds = JSON.parse(fs.readFileSync('data/dataset.json', 'utf8'));

// Map old players by id for quick lookup
const oldById = new Map();
for (const p of ds.players) oldById.set(p.id, p);

// Map new players by id
const newById = new Map();
for (const p of newPlayersRaw) newById.set(p.id, p);

// Set of new listone IDs
const newIds = new Set(newPlayersRaw.map(p => p.id));

// Giocatori rimossi (in dataset vecchio ma non nel nuovo listone)
const removed = ds.players.filter(p => !newIds.has(p.id));
console.log(`RIMOSSI dal listone (${removed.length}):`);
for (const p of removed) {
  console.log(`  - ${p.id} ${p.nome} (${p.squadra}) ${p.ruolo}`);
}

// Nuovi giocatori (nel listone ma non nel dataset)
const added = newPlayersRaw.filter(p => !oldById.has(p.id));
console.log(`\nNUOVI giocatori (${added.length}):`);
for (const p of added) {
  console.log(`  + ${p.id} ${p.nome} (${p.squadra}) ${p.ruolo} qt=${p.quotAttuale}`);
}

// Build new players array
const newPlayers = [];

for (const np of newPlayersRaw) {
  if (oldById.has(np.id)) {
    // Merge: usa dati esistenti per tutti i campi NON quotazione
    const op = oldById.get(np.id);
    const merged = {
      ...op,
      // Override quotazioni dal nuovo Excel
      quotAttuale:   np.quotAttuale,
      quotIniziale:  np.quotIniziale,
      diff:          np.diff,
      quotAttM:      np.quotAttM,
      quotIniM:      np.quotIniM,
      diffM:         np.diffM,
      fvm:           np.fvm,
      fvmM:          np.fvmM,
    };
    newPlayers.push(merged);
  } else {
    // Nuovo giocatore: costruisci record completo
    const base = {
      id: np.id,
      nome: np.nome,
      squadra: np.squadra,
      ruolo: np.ruolo,
      ruoloMantra: np.ruoloMantra,
      quotAttuale:   np.quotAttuale,
      quotIniziale:   np.quotIniziale,
      diff:           np.diff,
      quotAttM:       np.quotAttM,
      quotIniM:       np.quotIniM,
      diffM:          np.diffM,
      fvm:            np.fvm,
      fvmM:           np.fvmM,
      fascia:          null,
      prezzoGuida:     null,
      budgetPct:       null,
      pmaPct:         null,
      titolarita:      null,
      mv:              null,
      titolareXI:      null,
      ballottaggio:    null,
      valorizzato:     false,
      penalizzato:     false,
      giovane:         false,
      nomeNascosto:    false,
      rigorista:       false,
      punizioni:       false,
      corner:          false,
      noteGuida:       null,
      pupillo:         false,
      fasceGuida:      null,
      fmvGuida:        0,
      pmaGuida:        null,
    };
    newPlayers.push(base);
  }
}

// Verify counts
const byRole = { P: 0, D: 0, C: 0, A: 0 };
for (const p of newPlayers) byRole[p.ruolo] = (byRole[p.ruolo] || 0) + 1;
console.log(`\nNuovo dataset: ${newPlayers.length} giocatori`);
for (const [r, c] of Object.entries(byRole)) console.log(`  ${r}: ${c}`);

// Pupilli count
const pupilli = newPlayers.filter(p => p.pupillo);
console.log(`Pupilli: ${pupilli.length}`);

// With fascia
const withFascia = newPlayers.filter(p => p.fascia);
console.log(`Con fascia: ${withFascia.length}`);

// With prezzoGuida
const withPG = newPlayers.filter(p => p.prezzoGuida != null);
console.log(`Con prezzoGuida: ${withPG.length}`);

// Sort by id
newPlayers.sort((a, b) => a.id - b.id);

// Build new dataset object
const newDs = {
  generatedAt: new Date().toISOString(),
  version: ds.version,
  sourceFiles: ds.sourceFiles,
  stats: {
    totalPlayers: newPlayers.length,
    byRole: byRole,
    teams: ds.stats.teams,
    pupilli: pupilli.length,
    withFascia: withFascia.length,
    withPrezzoGuida: withPG.length,
    withTitolarita: newPlayers.filter(p => p.titolarita != null).length,
  },
  teams: ds.teams,
  fasceGuida: ds.fasceGuida,
  players: newPlayers,
};

fs.writeFileSync('data/dataset.json', JSON.stringify(newDs, null, 2), 'utf8');
console.log(`\n✓ Scritto data/dataset.json`);
console.log(`  Generato: ${newDs.generatedAt}`);
console.log(`  Totale: ${newDs.stats.totalPlayers}`);
