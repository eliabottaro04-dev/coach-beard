const { execSync } = require('child_process');
const path = require('path');

const projectDir = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\coach-beard-starter 2\\coach-beard-starter';

try {
  const result = execSync(`npm install better-sqlite3 xlsx zod`, {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 120000
  });
  console.log('Install output:', result);
} catch(e) {
  console.log('Install error:', e.message?.slice(0,500));
  console.log('Stderr:', e.stderr?.slice(0,500));
}
