import XLSX from 'xlsx';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const root = 'Dati';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.toLowerCase().endsWith('.xlsx')) out.push(p);
  }
  return out;
}

const files = walk(root);
for (const f of files) {
  console.log('\n========== FILE:', f, '==========');
  const wb = XLSX.readFile(f, { cellDates: false });
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length === 0) { console.log('  [', sheetName, '] empty'); continue; }
    console.log('\n  --- SHEET:', sheetName, '---');
    console.log('  ROWS TOTAL:', rows.length);
    // header
    console.log('  HEADER:', JSON.stringify(rows[0]));
    // prime 3 righe
    for (let i = 1; i < Math.min(4, rows.length); i++) {
      console.log('  R' + i + ':', JSON.stringify(rows[i]));
    }
    // ultima riga
    if (rows.length > 4) {
      console.log('  R' + (rows.length - 1) + ':', JSON.stringify(rows[rows.length - 1]));
    }
  }
}
