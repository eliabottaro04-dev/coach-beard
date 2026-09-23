const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Try to find python and openpyxl
try {
  const result = execSync('where python 2>&1 || where python3 2>&1 || echo "NOT_FOUND"', { encoding: 'utf8' });
  console.log('which python:', result.trim());
} catch(e) {}

// Look for venv
const base = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\coach-beard-starter 2\\coach-beard-starter';
const candidates = [
  path.join(base, '.venv', 'Scripts', 'python.exe'),
  path.join(base, 'venv', 'Scripts', 'python.exe'),
  path.join(base, '.env', 'Scripts', 'python.exe'),
];
for (const c of candidates) {
  console.log(c, fs.existsSync(c) ? 'EXISTS' : 'missing');
}

// Check node packages
console.log('\nnode_modules root:', fs.readdirSync(path.join(base, 'node_modules')).slice(0,20));

// Try openpyxl via python
try {
  const py = execSync('python -c "import openpyxl; print(openpyxl.__version__)" 2>&1', { encoding: 'utf8' });
  console.log('openpyxl version:', py.trim());
} catch(e) {
  console.log('openpyxl check failed:', e.message?.slice(0,200));
}
