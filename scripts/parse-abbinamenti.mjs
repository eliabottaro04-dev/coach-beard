// Parser degli abbinamenti dalle strategie Excel (StrategiaFanta.xlsx).
// Legge le sezioni "MIGLIORI ABBINAMENTI" da ciascun foglio ruolo e produce
// un JSON strutturato in data/abbinamenti.json.
//
// Formato sezione:
//   Riga 0: "MIGLIORI ABBINAMENTI" (titolo sezione)
//   Riga 1: "a N:" (quante squadre)  → es. "a 3:" oppure "a 2:"
//   Righe 2..N: combo "squadra1-squadra2-..." con rating "99/100" e info
// Colonne variabili per foglio: Portieri/Dif/Cent col 2, Attaccanti col 3.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';

// Risolvi la directory del progetto (due livelli sopra da scripts/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const STRATEGIA_PATH = join(PROJECT_ROOT, 'Dati', 'Strategie', 'StrategiaFanta.xlsx');
const OUT_PATH = join(PROJECT_ROOT, 'data', 'abbinamenti.json');

const TEAM_ALIAS = {
  // abbreviazioni usate nella strategia → nome canonico nel listone
  'bolo':    'bologna',
  'juve':    'juventus',
  'inter':   'inter',
  'milan':   'milan',
  'roma':    'roma',
  'napoli':  'napoli',
  'lazio':   'lazio',
  'fiorentina': 'fiorentina',
  'atalanta':'atalanta',
  'torino':  'torino',
  'genoa':   'genoa',
  'udinese': 'udinese',
  'sassuolo':'sassuolo',
  'verona':  'verona',
  'empoli':  'empoli',
  'cagliari':'cagliari',
  'lecce':   'lecce',
  'parma':   'parma',
  'como':    'como',
  'venezia': 'venezia',
  'monza':   'monza',
  'pisa':    'pisa',
  'cremonese':'cremonese',
  'frosinone':'frosinone',
  'salernitana':'salernitana',
  'sampdoria':'sampdoria',
  'spezia':  'spezia',
  'brescia': 'brescia',
  'reggiana':'reggiana',
  'catanzaro':'catanzaro',
  'juv':     'juventus',
  'mila':    'milan',
  'rom':     'roma',
  'nap':     'napoli',
  'laz':     'lazio',
  'fio':     'fiorentina',
  'ata':     'atalanta',
  'tor':     'torino',
  'gen':     'genoa',
  'udi':     'udinese',
  'sas':     'sassuolo',
  'ver':     'verona',
  'emp':     'empoli',
  'cag':     'cagliari',
  'lec':     'lecce',
  'par':     'parma',
  'com':     'como',
  'ven':     'venezia',
  'mon':     'monza',
};

function normalizeTeamName(t) {
  return TEAM_ALIAS[t.toLowerCase()] ?? t.toLowerCase();
}

const ROLE_SHEETS = [
  { sheet: 'Portieri',       role: 'P', abbinCol: 2 },
  { sheet: 'Difensori',      role: 'D', abbinCol: 2 },
  { sheet: 'Centrocampisti', role: 'C', abbinCol: 2 },
  { sheet: 'Attaccanti',     role: 'A', abbinCol: 3 },
];

if (!existsSync(STRATEGIA_PATH)) {
  console.error('❌ File strategia non trovato:', STRATEGIA_PATH);
  process.exit(1);
}

const wb = xlsx.readFile(STRATEGIA_PATH);
const out = { generatedAt: new Date().toISOString(), byRole: { P: [], D: [], C: [], A: [] } };

for (const { sheet, role, abbinCol } of ROLE_SHEETS) {
  if (!wb.Sheets[sheet]) {
    console.warn(`⚠️ Foglio ${sheet} non trovato`);
    continue;
  }
  const data = xlsx.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: null });

  // Trova la riga "MIGLIORI ABBINAMENTI" nella colonna giusta
  const startIdx = data.findIndex(
    (r) => r[abbinCol] && String(r[abbinCol]).toUpperCase().includes('MIGLIORI ABBINAMENTI')
  );
  if (startIdx < 0) {
    console.warn(`⚠️ Sezione abbinamenti non trovata in ${sheet}`);
    continue;
  }

  // Header "a N:" opzionale subito dopo
  const headerRow = data[startIdx + 1];
  const header = headerRow?.[abbinCol] ? String(headerRow[abbinCol]).trim() : null;
  // "a 3:" oppure "a 2:"
  const nMatch = header ? header.match(/a\s*(\d+)/i) : null;
  const expectedN = nMatch ? parseInt(nMatch[1], 10) : null;

  // Leggi righe combo fino a riga vuota o nuova sezione
  const combos = [];
  for (let i = startIdx + 2; i < data.length; i++) {
    const r = data[i];
    if (!r) break;
    // riga completamente vuota → fine sezione
    if (r.every((c) => c === null || c === undefined)) break;
    const comboStr = r[abbinCol];
    if (!comboStr) continue;
    const text = String(comboStr).trim();
    if (!text) continue;
    // filtra righe di solo testo descrittivo (es. "squadre che segnano tanto:")
    if (text.endsWith(':') && !text.includes('-')) continue;
    // filtra righe che iniziano con lettera minuscola e non hanno '-'
    if (!text.includes('-') && !text.includes('.')) continue;

    // Estrai rating: cerca "/100" ovunque nella riga
    let rating = null;
    for (let c = 0; c < r.length; c++) {
      const v = r[c];
      if (v == null) continue;
      const m = String(v).match(/(\d{2,3})\s*\/\s*100/);
      if (m) {
        rating = parseInt(m[1], 10);
        break;
      }
    }

    // Estrai info "N facili"
    let info = null;
    for (let c = 0; c < r.length; c++) {
      const v = r[c];
      if (v == null) continue;
      const m = String(v).match(/(\d+)\s*facili/);
      if (m) {
        info = `${m[1]} partite facili`;
        break;
      }
    }

    // Pulisci il nome combo: split per "-" e "."
    const teamsRaw = text
      .split(/[-\s.]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 3);

    if (teamsRaw.length < 2) continue;

    const teams = teamsRaw.map(normalizeTeamName);

    combos.push({
      teams,
      combo: teams.join('-'),
      rating,
      info,
    });
  }

  out.byRole[role] = {
    header,
    expectedN,
    combos,
  };
  console.log(`✅ ${sheet} (${role}): ${combos.length} combinazioni, attese a ${expectedN}`);
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf-8');
console.log(`\n📄 Scritto: ${OUT_PATH}`);
console.log(`   P: ${out.byRole.P.combos.length} | D: ${out.byRole.D.combos.length} | C: ${out.byRole.C.combos.length} | A: ${out.byRole.A.combos.length}`);
