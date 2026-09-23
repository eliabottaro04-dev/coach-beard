const { execSync } = require('child_process');
const path = require('path');

const projectDir = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\coach-beard-starter 2\\coach-beard-starter';

// Check npm version and cache
try {
  const npmVer = execSync('npm --version', { encoding: 'utf8' }).trim();
  console.log('npm version:', npmVer);
} catch(e) {
  console.log('npm --version error:', e.message?.slice(0,200));
}

// Try installing with --prefer-offline and longer timeout
try {
  const result = execSync(`npm install better-sqlite3 --prefer-offline --no-audit`, {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, npm_config_cache: 'C:\\Users\\Utente\\AppData\\Local\\npm-cache' }
  });
  console.log('Install output:', result.slice(0,500));
} catch(e) {
  console.log('Install error:', e.message?.slice(0,500));
  console.log('Stderr:', e.stderr?.slice(0,500));
}
