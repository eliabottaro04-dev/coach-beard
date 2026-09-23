const path = require('path');
const fs = require('fs');

// The project directory
const projectDir = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\coach-beard-starter 2\\coach-beard-starter';
const nmProject = path.join(projectDir, 'node_modules');
const nmClaude = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\Claude Gratis\\node_modules';

console.log('Project nm exists:', fs.existsSync(nmProject));
console.log('Claude nm exists:', fs.existsSync(nmClaude));

// Check better-sqlite3 in both
const bsProject = path.join(nmProject, 'better-sqlite3');
const bsClaude = path.join(nmClaude, 'better-sqlite3');
console.log('better-sqlite3 in project:', fs.existsSync(bsProject));
console.log('better-sqlite3 in Claude:', fs.existsSync(bsClaude));

// List project nm
if (fs.existsSync(nmProject)) {
  const contents = fs.readdirSync(nmProject);
  console.log('Project nm contents:', contents.slice(0,20));
}

// Check binding.gyp in both
if (fs.existsSync(bsProject)) {
  const hasBinding = fs.existsSync(path.join(bsProject, 'build'));
  console.log('Project bs has build dir:', hasBinding);
}
if (fs.existsSync(bsClaude)) {
  const hasBinding = fs.existsSync(path.join(bsClaude, 'build'));
  console.log('Claude bs has build dir:', hasBinding);
}
