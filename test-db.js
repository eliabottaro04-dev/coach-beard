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
