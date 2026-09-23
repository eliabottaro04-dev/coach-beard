// Esplora anche il foglio Ceduti
import XLSX from 'xlsx';
const excelPath = 'Dati/Listone E quotazioni/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx';
const wb = XLSX.readFile(excelPath);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log(`\n=== Sheet "${name}" (rows: ${raw.length}) ===`);
  for (let i = 0; i < Math.min(raw.length, 4); i++) {
    console.log(`R${i}: ${JSON.stringify(raw[i])}`);
  }
  if (raw.length > 4) {
    console.log(`... last: ${JSON.stringify(raw[raw.length - 1])}`);
  }
}
