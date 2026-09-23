// Legge Quotazioni_Fantacalcio_Stagione_2026_27.xlsx ed esporta tutti i giocatori come JSON
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const excelPath = path.resolve('Dati/Listone E quotazioni/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx');
const outPath = path.resolve('data/excel_players.json');

const wb = XLSX.readFile(excelPath);
const sheetName = wb.SheetNames[0];
console.log('Sheet names:', wb.SheetNames);
const ws = wb.Sheets[sheetName];

// Leggi come array di array
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

console.log('Total rows:', raw.length);
console.log('Row 0:', JSON.stringify(raw[0]));
console.log('Row 1:', JSON.stringify(raw[1]));
console.log('Row 2:', JSON.stringify(raw[2]));

// Riga 2 (index 1) = header: Id|R|RM</minimax:tool_call>|SWEET|Name|-----
// Riga 3 (index 2) = primo giocatore
const headers = raw[1]; // ["Id","R","RM","Nome","妻子|--------", ...]
console.log('Headers:', headers ? JSON.stringify(headers) : '(none)');

const players = [];
for (let i = 2; i < raw.length; i++) {
  const row = raw[i];
  const id = row[0];
  if (!id || String(id).trim() === '') continue;

  const quotAttRaw = row[5];
  const quotIniRaw = row[6];
  const diffRaw = row[7];
  const quotAttMRaw = row[8];
  const quotIniMRaw = row[9];
  const diffMRaw = row[10];
  const fvmRaw = row[11];
  const fvmMRaw = row[12];

  const toInt = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseInt(String(v).replace(',', '.'), 10);
    return isNaN(n) ? null : n;
  };
  const toInt0 = (v) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = parseInt(String(v).replace(',', '.'), 10);
    return isNaN(n) ? 0 : n;
  };

  players.push({
    id: toInt(id),
    ruolo: String(row[1] || '').trim(),
    ruoloMantra: String(row[2] || '').trim(),
    nome: String(row[3] || '').trim(),
    squadra: String(row[4] || '').trim(),
    quotAttuale: toInt(quotAttRaw),
    quotIniziale: toInt(quotIniRaw),
    diff: toInt0(diffRaw),
    quotAttM: toInt(quotAttMRaw),
    quotIniM: toInt(quotIniMRaw),
    diffM: toInt0(diffMRaw),
    fvm: toInt(fvmRaw),
    fvmM: toInt(fvmMRaw),
  });
}

console.log(`Total players: ${players.length}`);
const byRole = {};
for (const p of players) {
  byRole[p.ruolo] = (byRole[p.ruolo] || 0) + 1;
}
console.log('By role:', byRole);

// Export per ogni ruolo
for (const r of ['P', 'D', 'C', 'A']) {
  const rplayers = players.filter(p => p.ruolo === r);
  console.log(`${r} (${rplayers.length}): ${rplayers.slice(0, 5).map(p => `${p.id} ${p.nome}`).join(', ')}`);
}

fs.writeFileSync(outPath, JSON.stringify(players, null, 2), 'utf8');
console.log(`Exported to ${outPath}`);
