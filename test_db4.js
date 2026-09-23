const path = require('path');
const fs = require('fs');

// Use packages from Claude Gratis where they're installed
const claudeNm = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\Claude Gratis\\node_modules';

// Set NODE_PATH to include Claude Gratis node_modules
module.paths.unshift(claudeNm);

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
  db.exec('INSERT INTO test (name) VALUES ("Elia")');
  const rows = db.prepare('SELECT * FROM test').all();
  console.log('better-sqlite3 works! Rows:', JSON.stringify(rows));
  db.close();
} catch(e) {
  console.log('better-sqlite3 error:', e.message);
}
