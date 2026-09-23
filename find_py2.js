const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const nm = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\coach-beard-starter 2\\coach-beard-starter\\node_modules';

// Check if sheetjs xlsx is installed
try {
  const xlsx = require(path.join(nm, 'xlsx'));
  console.log('xlsx (sheetjs) available:', xlsx.version || 'yes');
} catch(e) {
  console.log('xlsx (sheetjs) NOT available');
}

// Check for other excel packages
const dirs = fs.readdirSync(nm);
const excelPkgs = dirs.filter(d => ['xlsx','exceljs','sheetjs','jszip','openpyxl'].some(k => d.includes(k)));
console.log('excel-related packages:', excelPkgs.join(', '));

// Find real python.exe (not WindowsApps)
try {
  const out = execSync(`dir /b /s "C:\\Users\\Utente\\python.exe" 2>nul`, { encoding: 'utf8', timeout: 30000 });
  const lines = out.trim().split('\n').filter(l => l.includes('python.exe') && !l.includes('WindowsApps'));
  lines.forEach(l => console.log('python:', l));
} catch(e) {}

// Also try common install dirs
for (const d of ['C:\\Python39\\python.exe','C:\\Python310\\python.exe','C:\\Python311\\python.exe','C:\\Python312\\python.exe','C:\\Python313\\python.exe']) {
  if (fs.existsSync(d)) console.log('Found:', d);
}
