const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Search common locations
const roots = [
  'C:\\Program Files\\Python*',
  'C:\\Program Files (x86)\\Python*',
  'C:\\Users\\Utente\\AppData\\Local\\Programs\\Python*',
  'C:\\Users\\Utente\\AppData\\Local\\Microsoft\\WindowsApps',
];

for (const r of roots) {
  try {
    const dirs = execSync(`dir /b /ad "${r}" 2>&1`, { encoding: 'utf8' });
    console.log('Found in', r);
    console.log(dirs.trim().split('\n').filter(Boolean).join('\n'));
  } catch(e) {
    // skip
  }
}

// Check if python works at all with --version
try {
  const v = execSync('python --version 2>&1', { encoding: 'utf8' });
  console.log('python version:', v.trim());
} catch(e) {
  console.log('python --version failed:', e.message?.slice(0,200));
}

// List all .venv or virtual environments in the project tree
const base = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\coach-beard-starter 2\\coach-beard-starter';
try {
  const entries = execSync(`dir /b /s "${base}\\Scripts\\activate*" 2>&1`, { encoding: 'utf8' });
  console.log('activate scripts found:', entries.trim().split('\n').filter(Boolean).join('\n'));
} catch(e) {}

// Check pip packages
try {
  const pip = execSync('pip list 2>&1', { encoding: 'utf8' });
  console.log('pip packages:', pip.trim().split('\n').slice(0,30).join('\n'));
} catch(e) {
  console.log('pip list failed:', e.message?.slice(0,200));
}
