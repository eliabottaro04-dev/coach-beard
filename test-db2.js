const path = require('path');
const nm = path.join(process.cwd(), 'node_modules');
console.log('cwd:', process.cwd());
console.log('nm:', nm);
const fs = require('fs');
try {
  console.log('better-sqlite3 exists:', fs.existsSync(path.join(nm, 'better-sqlite3')));
  console.log('xlsx exists:', fs.existsSync(path.join(nm, 'xlsx')));
  console.log('zod exists:', fs.existsSync(path.join(nm, 'zod')));
  // try to list better-sqlite3 contents
  if (fs.existsSync(path.join(nm, 'better-sqlite3'))) {
    const contents = fs.readdirSync(path.join(nm, 'better-sqlite3'));
    console.log('better-sqlite3 contents:', contents.slice(0,20));
  }
} catch(e) {
  console.log('Error:', e.message);
}
