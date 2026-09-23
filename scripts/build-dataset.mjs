// FASE 1 — Costruzione dataset unificato
// Legge i 4 Excel in Dati/ e produce dataset.json (in data/dataset.json).
// Unisce le fonti usando come chiave (Nome normalizzato + Squadra normalizzata + Ruolo).
// In caso di nomi non risolti o ambigui, produce un report dettagliato
// (data/ingestion-report.json). In modalità strict, il processo si blocca.

import XLSX from 'xlsx';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolvePlayer } from './resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');

// Modalità strict: se true, l'ingestione si blocca al primo nome ambiguo o non risolto.
// Default: false (warn + report). Per validare in CI: STRICT=1 node scripts/build-dataset.mjs
const STRICT = process.env.STRICT === '1';

// ---------- utility di normalizzazione ----------
const norm = (s) => (s == null ? '' : String(s))
  .normalize('NFD').replace(/[̀-ͯ]/g, '') // togli accenti
  .replace(/[''`´]/g, "'")
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const normKey = (nome, squadra, ruolo) =>
  `${norm(nome)}|${norm(squadra)}|${norm(ruolo)}`;

// converte 0/1/null in true/false/null
const toBool = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['sì', 'si', 'yes', 'true', '1', 'x'].includes(s)) return true;
  if (['no', 'false', '0'].includes(s)) return false;
  return null;
};

// num "0.55" o 0.55 → 0.55 ; null/"" → null
const toNum = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------- lettura file Excel ----------
function readSheet(file, sheetName) {
  const wb = XLSX.readFile(resolve(ROOT, file), { cellDates: false });
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  // header alla riga 0
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (arr.length < 2) return [];
  const headers = arr[0].map((h) => (h == null ? '' : String(h).trim()));
  return arr.slice(1).map((row) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i] ?? null; });
    return o;
  });
}

// Il listone ha la riga di header spostata: prima riga è titolo, seconda è header vero
function readListone(file, sheetName) {
  const wb = XLSX.readFile(resolve(ROOT, file), { cellDates: false });
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  // trova la prima riga che contiene "Id" o "Nome"
  let headerIdx = arr.findIndex((r) => Array.isArray(r) && r.some((c) => c === 'Id'));
  if (headerIdx === -1) headerIdx = 0;
  const headers = arr[headerIdx].map((h) => (h == null ? '' : String(h).trim()));
  return arr.slice(headerIdx + 1).map((row) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i] ?? null; });
    return o;
  }).filter((o) => o.Id != null && o.Nome);
}

// ---------- 1) LISTONE (fonte canonica, 537 calciatori) ----------
console.log('[1/4] Leggo il listone...');
const listoneRaw = readListone('Dati/Listone E quotazioni/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx', 'Tutti');
console.log(`     listone: ${listoneRaw.length} righe`);

// mappa per chiave normalizzata
const players = new Map();
const idToKey = new Map();
for (const r of listoneRaw) {
  const id    = Number(r.Id);
  const ruolo = r.R;
  const nome  = (r.Nome || '').trim();
  const sq    = (r.Squadra || '').trim();
  if (!id || !nome || !sq || !ruolo) continue;
  const key = normKey(nome, sq, ruolo);
  const obj = {
    id,
    nome,
    squadra: sq,
    ruolo,                  // 'P' | 'D' | 'C' | 'A'
    ruoloMantra: r.RM || null,           // es. "Por", "E", "T;A"
    quotAttuale:   toNum(r['Qt.A']),
    quotIniziale:  toNum(r['Qt.I']),
    diff:          toNum(r['Diff.']),
    quotAttM:      toNum(r['Qt.A M']),
    quotIniM:      toNum(r['Qt.I M']),
    fvm:           toNum(r.FVM),
    fvmM:          toNum(r['FVM M']),
    // --- si riempiono dopo ---
    fascia: null,            // Top / Mid / Low / ... dalla guida esperto
    prezzoGuida: null,       // prezzo consigliato dalla guida
    budgetPct: null,         // % del budget (es. 0.336 = 33.6%)
    pmaPct: null,
    titolarita: null,        // 0..1
    mv: null,
    titolareXI: null,
    ballottaggio: null,
    valorizzato: false,
    penalizzato: false,
    giovane: false,
    nomeNascosto: false,
    rigorista: false,
    punizioni: false,
    corner: false,
    noteGuida: null,         // stringa, dalla guida oggettiva
    pupillo: false,
    fasceGuida: null,        // mappa { Top: [{nome,prezzo}], Mid: [...], ... } popolata dopo
  };
  players.set(key, obj);
  idToKey.set(id, key);
}
console.log(`     mappati: ${players.size} calciatori unici`);

// ---------- 2) GUIDA OGGETTIVA (Guida_Asta_202627.xlsx) ----------
console.log('[2/4] Leggo la guida oggettiva...');
const guidaGiocatori = readSheet('Dati/Dati Su Giocatori, Allenatori e Squadre/Guida_Asta_202627.xlsx', 'Giocatori');
console.log(`     guida giocatori: ${guidaGiocatori.length} righe`);

// report resolver (popolato durante tutta l'ingestione)
const resolverReport = {
  guida: { resolved: 0, ambiguous: [], unresolved: [] },
  ballottaggi: { resolved: 0, ambiguous: [], unresolved: [] },
  note: { resolved: 0, ambiguous: [], unresolved: [] },
  guidaPersonale: { resolved: 0, ambiguous: [], unresolved: [] },
  pupilli: { resolved: 0, ambiguous: [], unresolved: [] },
};

function enrichPlayer(guideRow, p) {
  p.titolarita   = toNum(guideRow['Titolarità']);
  p.mv           = toNum(guideRow.MV);
  p.fmvGuida     = toNum(guideRow.FMV);
  p.pmaGuida     = toNum(guideRow.PMA);
  p.titolareXI   = toBool(guideRow['Titolare XI']);
  p.rigorista    = !!toBool(guideRow.Rigorista);
  p.punizioni    = !!toBool(guideRow.Punizioni);
  p.corner       = !!toBool(guideRow.Corner);
  p.ballottaggio = (guideRow.Ballottaggio || '').toString().trim() || null;
  p.valorizzato  = !!toBool(guideRow.Valorizzato);
  p.penalizzato  = !!toBool(guideRow.Penalizzato);
  p.giovane      = !!toBool(guideRow.Giovane);
  p.nomeNascosto = !!toBool(guideRow['Nome nascosto']);
  p.noteGuida    = (guideRow['Note guida'] || '').toString().trim() || null;
}

let matchedGuida = 0, unmatchedGuida = 0;
for (const r of guidaGiocatori) {
  const nome   = (r.Giocatore || '').toString().trim();
  const sq     = (r.Squadra   || '').toString().trim();
  const ruolo  = (r.Ruolo     || '').toString().trim();
  const inputKey = { name: nome, squadra: sq, ruolo };

  // 1) Prova resolver (alias → id)
  const r1 = resolvePlayer(inputKey);
  let p = null;
  if (r1.ok) p = players.get(idToKey.get(r1.playerId));

  // 2) Fallback: chiave composta
  if (!p) {
    const key = normKey(nome, sq, ruolo);
    p = players.get(key);
  }

  if (!p) {
    unmatchedGuida++;
    const r2 = resolvePlayer(inputKey); // ri-ottieni per il reason
    if (r2.reason === 'ambiguous') {
      resolverReport.guida.ambiguous.push({ name: nome, sq, ruolo, candidates: r2.candidates });
    } else {
      resolverReport.guida.unresolved.push({ name: nome, sq, ruolo });
    }
    continue;
  }
  matchedGuida++;
  resolverReport.guida.resolved++;
  enrichPlayer(r, p);
}
console.log(`     match guida: ${matchedGuida} ok, ${unmatchedGuida} non trovati`);
if (resolverReport.guida.ambiguous.length > 0) {
  console.log(`     ❌ ${resolverReport.guida.ambiguous.length} AMBIGUI (bloccano se STRICT=1)`);
}

// arricchiamo con ballottaggi (chi è primo/secondo di ballottaggio)
const ballottaggi = readSheet('Dati/Dati Su Giocatori, Allenatori e Squadre/Guida_Asta_202627.xlsx', 'Ballottaggi');
let matchedBall = 0, unmatchedBall = 0;
for (const r of ballottaggi) {
  // per ogni giocatore nella riga cerchiamo la percentuale
  const squad = r.Squadra;
  const ruolo = r['Ruoli']; // es "A/A"
  for (let i = 1; i <= 3; i++) {
    const nm = r[`Giocatore ${i}`];
    const pct = r[`% ${i === 3 ? 'ultimo' : i}`];
    if (!nm) continue;
    const ruoloBall = ruolo.split('/')[i - 1] || ruolo.split('/')[0];
    const r1 = resolvePlayer({ name: nm, squadra: squad, ruolo: ruoloBall });
    let p = null;
    if (r1.ok) p = players.get(idToKey.get(r1.playerId));
    else {
      const k = normKey(nm, squad, ruoloBall);
      p = players.get(k);
    }
    if (!p) {
      unmatchedBall++;
      if (r1.reason === 'ambiguous') resolverReport.ballottaggi.ambiguous.push({ name: nm, sq: squad, ruolo: ruoloBall, candidates: r1.candidates });
      else if (!r1.ok) resolverReport.ballottaggi.unresolved.push({ name: nm, sq: squad, ruolo: ruoloBall });
      continue;
    }
    matchedBall++;
    resolverReport.ballottaggi.resolved++;
    p.titolarita = Math.max(p.titolarita ?? 0, toNum(pct) ?? 0);
  }
}
console.log(`     match ballottaggi: ${matchedBall} ok, ${unmatchedBall} non trovati`);

// note dettagliate
const note = readSheet('Dati/Dati Su Giocatori, Allenatori e Squadre/Guida_Asta_202627.xlsx', 'Note');
for (const r of note) {
  const r1 = resolvePlayer({ name: r.Giocatore, squadra: r.Squadra, ruolo: r.Ruolo });
  let p = null;
  if (r1.ok) p = players.get(idToKey.get(r1.playerId));
  else p = players.get(normKey(r.Giocatore, r.Squadra, r.Ruolo));
  if (!p) continue;
  const n = (r.Nota || '').toString().trim();
  if (!n) continue;
  p.noteGuida = p.noteGuida ? `${p.noteGuida} | ${n}` : n;
}

// ---------- 3) GUIDA PERSONALE (StrategiaFanta.xlsx) ----------
console.log('[3/4] Leggo la guida personale (StrategiaFanta)...');
const fasceGuida = { Top: [], Mid: [], Low: [] };
const guidaPerRuolo = [
  { sheet: 'Portieri',      ruolo: 'P' },
  { sheet: 'Difensori',     ruolo: 'D' },
  { sheet: 'Centrocampisti',ruolo: 'C' },
  { sheet: 'Attaccanti',    ruolo: 'A' },
];
let matchedStrat = 0, unmatchedStrat = 0;
for (const { sheet, ruolo } of guidaPerRuolo) {
  const rows = readSheet('Dati/Strategie/StrategiaFanta.xlsx', sheet);
  for (const r of rows) {
    const fascia = (r.Fascia || '').toString().trim();
    const nome   = (r.Nome   || '').toString().trim();
    const sq     = (r.Squadra|| '').toString().trim();
    const prezzo = toNum(r.Prezzo);
    const bPct   = toNum(r['Budget %']);
    const pPct   = toNum(r['PMA %']);
    if (!nome || !fascia) continue;
    fasceGuida[fascia] = fasceGuida[fascia] || [];
    fasceGuida[fascia].push({ nome, sq, ruolo, prezzo, budgetPct: bPct, pmaPct: pPct });
    // prova prima con resolver (gestisce alias)
    const r1 = resolvePlayer({ name: nome, squadra: sq, ruolo });
    let p = null;
    if (r1.ok) p = players.get(idToKey.get(r1.playerId));
    else p = players.get(normKey(nome, sq, ruolo));
    if (!p) {
      unmatchedStrat++;
      if (r1.reason === 'ambiguous') resolverReport.guidaPersonale.ambiguous.push({ name: nome, sq, ruolo, candidates: r1.candidates });
      else if (!r1.ok) resolverReport.guidaPersonale.unresolved.push({ name: nome, sq, ruolo });
      continue;
    }
    matchedStrat++;
    resolverReport.guidaPersonale.resolved++;
    p.fascia       = fascia;
    p.prezzoGuida  = prezzo;
    p.budgetPct    = bPct;
    p.pmaPct       = pPct;
  }
}
console.log(`     match guida personale: ${matchedStrat} ok, ${unmatchedStrat} non trovati`);

// ---------- 4) PUPILLI ----------
console.log('[4/4] Leggo i pupilli...');
const pupilliWb = XLSX.readFile(resolve(ROOT, 'Dati/Strategie/Pupilli.xlsx'), { cellDates: false });
const pupilliSheet = pupilliWb.Sheets[pupilliWb.SheetNames[0]];
// converto in array di array e trovo l'intervallo di righe/colonne con dati
const pupilliAOA = XLSX.utils.sheet_to_json(pupilliSheet, { header: 1, defval: null, blankrows: true });

const ruoloFromPrefix = (prefix) => {
  const p = (prefix || '').toUpperCase().trim();
  if (p.startsWith('POR')) return 'P';
  if (p.startsWith('DC') || p.startsWith('DD') || p.startsWith('DS')) return 'D';
  if (p.startsWith('CEN') || p.startsWith('C ')) return 'C';
  if (p === 'C' || p.startsWith('C,')) return 'C';
  if (p.startsWith('ATT') || p === 'A') return 'A';
  return null;
};

// Funzione di match tollerante: gestisce "Molina" vs "Molina N.", "De Roon" vs "De Roon R.",
// "Cacciamani" vs "Cacciamani Torino", "Pedersen" vs "Pedersen W."
function findPlayerByName(nome, ruolo) {
  const nn = norm(nome);
  let best = null;
  let bestScore = 0;
  for (const p of players.values()) {
    if (p.ruolo !== ruolo) continue;
    const np = norm(p.nome);
    // 1) match esatto (dopo normalizzazione)
    if (np === nn) return p;
    // 2) match per cognome = prima parola (es. "Cacciamani" vs "Cacciamani Torino")
    const cognomeP = np.split(' ')[0].replace(/[.,]/g, '');
    const cognomeN = nn.split(' ')[0].replace(/[.,]/g, '');
    if (cognomeP && cognomeP === cognomeN && cognomeP.length >= 4) {
      // match per cognome: ok, ma se c'è più di un candidato con stesso cognome, prendi il più quotato
      const score = cognomeP.length;
      if (score > bestScore) { best = p; bestScore = score; }
      continue;
    }
    // 3) match parziale: il nome cercato è contenuto nel nome del listone
    if (np.includes(nn) && nn.length >= 4) {
      const score = nn.length;
      if (score > bestScore) { best = p; bestScore = score; }
    }
  }
  return best;
}

let pupilliCount = 0;
let pupilliMancanti = [];
for (const row of pupilliAOA) {
  if (!Array.isArray(row) || row.length === 0) continue;
  // cerca la prima cella non-vuota della riga e prova a estrarre l'etichetta di ruolo
  let label = null, value = null;
  for (const cell of row) {
    if (cell == null) continue;
    const s = cell.toString().trim();
    if (!s) continue;
    // cerca pattern "POR:" "DC:" "ATT:" o "POR" "DC" "ATT" seguiti da ":"
    const m = s.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
    if (m) {
      const candidate = m[1].toUpperCase().trim();
      if (['POR', 'DC', 'DD', 'DS', 'C', 'CEN', 'CENTROCAMPISTI', 'CENTROCAMP', 'ATT', 'A'].includes(candidate)
          || candidate.startsWith('POR') || candidate.startsWith('DC') || candidate.startsWith('DD') || candidate.startsWith('DS')
          || candidate.startsWith('CEN') || candidate.startsWith('ATT')) {
        label = m[1];
        value = m[2].trim();
        break;
      }
    }
    // se la cella è solo un'etichetta, salvala
    if (/^(POR|DC|DD|DS|CEN|CENTROCAMPISTI|CENTROCAMP|C|ATT|A)\s*:?\s*$/i.test(s)) {
      label = s.replace(':', '').trim();
      continue;
    }
    if (label) { value = s; break; }
  }
  if (!label || !value) continue;
  const ruolo = ruoloFromPrefix(label);
  if (!ruolo) continue;
  const nomi = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (const nome of nomi) {
    // usa il resolver (priorità assoluta agli alias, poi match esatto, poi fuzzy)
    const r1 = resolvePlayer({ name: nome, ruolo });
    let found = null;
    if (r1.ok) found = players.get(idToKey.get(r1.playerId));
    else found = findPlayerByName(nome, ruolo); // fallback tollerante
    if (found) { found.pupillo = true; pupilliCount++; resolverReport.pupilli.resolved++; }
    else {
      pupilliMancanti.push(`[${ruolo}] ${nome}`);
      if (r1.reason === 'ambiguous') resolverReport.pupilli.ambiguous.push({ name: nome, ruolo, candidates: r1.candidates });
      else if (!r1.ok) resolverReport.pupilli.unresolved.push({ name: nome, ruolo });
    }
  }
}
console.log(`     pupilli: ${pupilliCount} marcati`);
if (pupilliMancanti.length > 0) {
  console.log(`     non trovati (${pupilliMancanti.length}): ${pupilliMancanti.join(', ')}`);
}
if (resolverReport.pupilli.ambiguous.length > 0) {
  console.log(`     ⚠️  ${resolverReport.pupilli.ambiguous.length} ambigui nei pupilli (vedi report)`);
}

// ---------- costruisci indice squadre e riepilogo ----------
const squadre = new Set();
for (const p of players.values()) squadre.add(p.squadra);
const ruoli = { P: 0, D: 0, C: 0, A: 0 };
for (const p of players.values()) ruoli[p.ruolo]++;

// ---------- scrivi dataset.json ----------
const out = {
  generatedAt: new Date().toISOString(),
  version: '1.0.0',
  sourceFiles: [
    'Dati/Listone E quotazioni/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx',
    'Dati/Dati Su Giocatori, Allenatori e Squadre/Guida_Asta_202627.xlsx',
    'Dati/Strategie/StrategiaFanta.xlsx',
    'Dati/Strategie/Pupilli.xlsx',
  ],
  stats: {
    totalPlayers: players.size,
    byRole: ruoli,
    teams: squadre.size,
    pupilli: pupilliCount,
    withFascia: [...players.values()].filter((p) => p.fascia).length,
    withPrezzoGuida: [...players.values()].filter((p) => p.prezzoGuida != null).length,
    withTitolarita: [...players.values()].filter((p) => p.titolarita != null).length,
  },
  teams: [...squadre].sort(),
  fasceGuida,
  players: [...players.values()].sort((a, b) => {
    if (a.ruolo !== b.ruolo) return a.ruolo.localeCompare(b.ruolo);
    return a.nome.localeCompare(b.nome);
  }),
};

// ---------- REPORT DI INGESTIONE ----------
const reportPath = resolve(ROOT, 'data', 'ingestion-report.json');
const allAmbiguous = [
  ...resolverReport.guida.ambiguous,
  ...resolverReport.ballottaggi.ambiguous,
  ...resolverReport.guidaPersonale.ambiguous,
  ...resolverReport.pupilli.ambiguous,
];
const allUnresolved = [
  ...resolverReport.guida.unresolved,
  ...resolverReport.ballottaggi.unresolved,
  ...resolverReport.guidaPersonale.unresolved,
  ...resolverReport.pupilli.unresolved,
];
const report = {
  generatedAt: new Date().toISOString(),
  strict: STRICT,
  sources: [
    { name: 'Guida oggettiva', file: 'Guida_Asta_202627.xlsx · Giocatori', rows: guidaGiocatori.length },
    { name: 'Ballottaggi', file: 'Guida_Asta_202627.xlsx · Ballottaggi', rows: ballottaggi.length },
    { name: 'Note', file: 'Guida_Asta_202627.xlsx · Note', rows: note.length },
    { name: 'Guida personale', file: 'StrategiaFanta.xlsx', rows: guidaPerRuolo.reduce((s, r) => s + readSheet('Dati/Strategie/StrategiaFanta.xlsx', r.sheet).length, 0) },
    { name: 'Pupilli', file: 'Pupilli.xlsx', rows: pupilliAOA.filter((r) => r.some((c) => c != null)).length },
  ],
  resolver: {
    totalInputsProcessed: resolverReport.guida.resolved + resolverReport.guida.ambiguous.length + resolverReport.guida.unresolved.length,
    resolved: resolverReport.guida.resolved + resolverReport.guidaPersonale.resolved + resolverReport.pupilli.resolved,
    ambiguousCount: allAmbiguous.length,
    unresolvedCount: allUnresolved.length,
    ambiguous: allAmbiguous.slice(0, 50),
    unresolved: allUnresolved.slice(0, 50),
    // suggerimenti alias per gli ambigui
    aliasSuggestions: allAmbiguous.map((a) => {
      const name = a.input.nome || a.input;
      return {
        ambiguous: name,
        candidates: a.candidates.map((id) => {
          const p = players.get(idToKey.get(id));
          return p ? { playerId: id, display: `"${p.nome}" (${p.squadra}, ${p.ruolo})` } : { playerId: id };
        }),
        suggestion: `Aggiungi in data/aliases.json: { "from": "${name}", "toPlayerId": <id_scelto>, "fuzzy": false }`,
      };
    }),
  },
  blocked: false,
};

writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(`\n📋 Report ingestione: ${reportPath}`);

if (allAmbiguous.length > 0) {
  console.log(`\n❌ ${allAmbiguous.length} NOMI AMBIGUI trovati (l'ingestione NON indovina mai):`);
  for (const a of allAmbiguous.slice(0, 10)) {
    const name = a.name || a.nome || '(senza nome)';
    const opts = a.candidates.map((id) => {
      const p = players.get(idToKey.get(id));
      return p ? `${p.nome} (${p.squadra}, ${p.ruolo})` : `id ${id}`;
    }).join('  |  ');
    console.log(`   • "${name}"${a.sq ? ` [${a.sq}/${a.ruolo}]` : ''}  → candidati: ${opts}`);
  }
  console.log(`   → Aggiungi alias espliciti in data/aliases.json per risolverli.`);
}

if (allUnresolved.length > 0) {
  console.log(`\n⚠️  ${allUnresolved.length} NOMI NON RISOLTI (non in listone 2026-27 o refuso):`);
  for (const u of allUnresolved.slice(0, 10)) {
    const name = u.name || u.nome || '(senza nome)';
    const sq = u.sq || u.squadra || '';
    console.log(`   • "${name}"${sq ? ` [${sq}/${u.ruolo}]` : ''}`);
  }
}

if (STRICT && (allAmbiguous.length > 0 || allUnresolved.length > 0)) {
  report.blocked = true;
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n🛑 INGESTIONE BLOCCATA (STRICT=true). Risolvi i ${allAmbiguous.length} ambigui e ${allUnresolved.length} irrisolti, poi riprova.`);
  process.exit(1);
}

const outDir = resolve(ROOT, 'data');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'dataset.json');
writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
const kb = (readFileSync(outPath).length / 1024).toFixed(1);
console.log(`\n✅ Scritto ${outPath}  (${kb} KB)`);
console.log(`   Calciatori: ${out.stats.totalPlayers} | Ruoli: P=${ruoli.P} D=${ruoli.D} C=${ruoli.C} A=${ruoli.A}`);
console.log(`   Squadre: ${out.stats.teams} | Pupilli: ${out.stats.pupilli}`);
console.log(`   Con fascia: ${out.stats.withFascia} | Con prezzo guida: ${out.stats.withPrezzoGuida}`);
console.log(`   Con titolarità: ${out.stats.withTitolarita}`);
if (allAmbiguous.length > 0 || allUnresolved.length > 0) {
  console.log(`\n📋 Report completo in: data/ingestion-report.json`);
  console.log(`   Per bloccare su ambigui: STRICT=1 node scripts/build-dataset.mjs`);
}
